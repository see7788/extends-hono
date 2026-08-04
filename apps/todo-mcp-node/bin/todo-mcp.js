#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, writeSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(import.meta.url);
const wrapperDir = dirname(wrapper);
const packageRoot = resolve(wrapperDir, "..");
const entry = resolve(wrapperDir, "../vite.config.ts");
const commandName = "todo-mcp";
const commandArg = process.argv[2];
const explicitCommand = commandArg === "dev" || commandArg === "start" || commandArg === "stop" || commandArg === "restart"
  ? commandArg
  : undefined;
const command = explicitCommand ?? "dev";
const runtimeCommand = command === "restart" ? "dev" : command;
const passthroughArgs = explicitCommand ? process.argv.slice(3) : process.argv.slice(2);

const pathNormalize = (pathValue) => pathValue.toLowerCase().replaceAll("\\", "/");
const nodeEnv = runtimeCommand === "dev"
  ? "development"
  : runtimeCommand === "start"
    ? "production"
    : process.env.NODE_ENV;
const instanceId = createHash("sha256")
  .update(`${pathNormalize(packageRoot)}\n${pathNormalize(entry)}`)
  .digest("hex")
  .slice(0, 16);
const controlName = `${commandName.replace(/[^a-z0-9._-]/gi, "-")}-${instanceId}`;
const controlPath = process.platform === "win32"
  ? `\\\\.\\pipe\\${controlName}`
  : process.platform === "linux"
    ? `${String.fromCharCode(0)}${controlName}`
    : join(tmpdir(), `${controlName}.sock`);

const processInfosGet = () => {
  if (process.platform === "win32") {
    const processResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (processResult.error) throw processResult.error;
    if (processResult.status !== 0) {
      throw new Error(`Failed to query Windows processes: ${processResult.stderr || processResult.stdout}`);
    }
    const parsed = JSON.parse(processResult.stdout || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const processResult = spawnSync("ps", ["-eo", "pid=,ppid=,command="], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0) {
    throw new Error(`Failed to query processes: ${processResult.stderr || processResult.stdout}`);
  }
  return (processResult.stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) throw new Error(`Cannot parse ps output line: ${line}`);
      return {
        ProcessId: Number(match[1]),
        ParentProcessId: Number(match[2]),
        CommandLine: match[3],
      };
    });
};

const currentProcessIdsGet = (processInfos) => {
  const processMap = new Map(processInfos.map((processInfo) => [
    Number(processInfo.ProcessId),
    Number(processInfo.ParentProcessId),
  ]));
  const currentProcessIds = new Set([process.pid]);
  for (let processId = process.pid; processMap.has(processId);) {
    const parentProcessId = processMap.get(processId);
    if (parentProcessId === undefined || !Number.isInteger(parentProcessId) || currentProcessIds.has(parentProcessId)) break;
    currentProcessIds.add(parentProcessId);
    processId = parentProcessId;
  }
  return currentProcessIds;
};

const orphanProcessIdsGet = () => {
  const processInfos = processInfosGet();
  const currentProcessIds = currentProcessIdsGet(processInfos);
  const entryPath = pathNormalize(entry);
  const matchedProcesses = processInfos
    .map((processInfo) => ({
      processId: Number(processInfo.ProcessId),
      parentProcessId: Number(processInfo.ParentProcessId),
      commandLine: pathNormalize(String(processInfo.CommandLine ?? "")),
    }))
    .filter(({ processId, commandLine }) => (
      Number.isInteger(processId)
      && !currentProcessIds.has(processId)
      && commandLine.includes(entryPath)
    ));
  const matchedProcessIds = new Set(matchedProcesses.map(({ processId }) => processId));
  const processIds = matchedProcesses
    .filter(({ parentProcessId }) => !matchedProcessIds.has(parentProcessId))
    .map(({ processId }) => processId);

  return [...new Set(processIds)];
};

const processIdsStop = (processIds) => {
  if (processIds.length === 0) return;
  const stopResult = process.platform === "win32"
    ? spawnSync("taskkill", [...processIds.flatMap((processId) => ["/PID", String(processId)]), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    : spawnSync("kill", ["-TERM", ...processIds.map(String)], { stdio: "ignore", windowsHide: true });
  if (stopResult.error) throw stopResult.error;
  if (typeof stopResult.status === "number" && stopResult.status !== 0) {
    const runningProcessIds = new Set(processInfosGet().map((processInfo) => Number(processInfo.ProcessId)));
    const remainingProcessIds = processIds.filter((processId) => runningProcessIds.has(processId));
    if (remainingProcessIds.length > 0) {
      throw new Error(`Failed to stop process ids: ${remainingProcessIds.join(", ")}`);
    }
  }
};

const orphansStop = () => {
  const processIds = orphanProcessIdsGet();
  processIdsStop(processIds);
  return processIds;
};

const controlRequest = (action, timeout = 5000) => new Promise((resolveRequest, rejectRequest) => {
  let settled = false;
  let responseText = "";
  const socket = createConnection(controlPath);
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(value);
  };
  const timer = setTimeout(() => {
    socket.destroy();
    finish(rejectRequest, new Error(`${commandName} control request timed out: ${action}`));
  }, timeout);

  socket.setEncoding("utf8");
  socket.once("connect", () => {
    socket.write(`${JSON.stringify({ action })}\n`);
  });
  socket.on("data", (chunk) => {
    responseText += chunk;
    const newlineIndex = responseText.indexOf("\n");
    if (newlineIndex < 0) return;
    try {
      const response = JSON.parse(responseText.slice(0, newlineIndex));
      if (response.error) throw new Error(String(response.error));
      socket.end();
      finish(resolveRequest, response.state);
    } catch (error) {
      socket.destroy();
      finish(rejectRequest, error);
    }
  });
  socket.once("error", (error) => {
    if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
      finish(resolveRequest, undefined);
      return;
    }
    finish(rejectRequest, error);
  });
  socket.once("close", () => {
    if (!settled) {
      finish(rejectRequest, new Error(`${commandName} control connection closed without a response.`));
    }
  });
});

const controlReleasedWait = async () => {
  for (let index = 0; index < 100; index += 1) {
    if (!await controlRequest("status", 1000)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`${commandName} control channel was not released.`);
};

const controlRunningWait = async () => {
  let lastError;
  for (let index = 0; index < 100; index += 1) {
    try {
      const state = await controlRequest("status", 1000);
      if (state?.status === "running") return state;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`${commandName} did not enter the running state.`, { cause: lastError });
};

const statePrint = (message, state) => {
  writeSync(1, `${[
    `${commandName} ${message}`,
    `mode: ${state.mode}`,
    `pid: ${state.pid}`,
    ...(state.childPid ? [`child pid: ${state.childPid}`] : []),
    `entry: ${state.entry}`,
    `control: ${state.control}`,
  ].join("\n")}\n`);
};

if (command === "stop") {
  const stoppedState = await controlRequest("stop", 15000);
  if (stoppedState) {
    statePrint("stopped", stoppedState);
    await controlReleasedWait();
  } else {
    const processIds = orphansStop();
    console.log(processIds.length > 0
      ? `${commandName} removed ${processIds.length} orphan process${processIds.length === 1 ? "" : "es"}`
      : `${commandName} is not running`);
  }
  process.exit(0);
}

if (command === "restart") {
  const restartedState = await controlRequest("restart", 15000);
  if (restartedState) {
    statePrint("restarted", restartedState);
    process.exit(0);
  }
  const owner = spawn(process.execPath, [wrapper, "dev", ...passthroughArgs], {
    cwd: packageRoot,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  owner.unref();
  statePrint("restarted", await controlRunningWait());
  process.exit(0);
}

if (process.platform === "darwin" && existsSync(controlPath) && !await controlRequest("status")) {
  rmSync(controlPath, { force: true });
}

let child;
let lifecycle = "starting";
let isStopping = false;
let stopPromise;
let childRestart;
let exitScheduled = false;
const startedAt = new Date().toISOString();
const stateGet = () => ({
  command: commandName,
  mode: runtimeCommand,
  status: lifecycle,
  pid: process.pid,
  childPid: child?.pid,
  entry,
  packageRoot,
  wrapper,
  startedAt,
  control: process.platform === "linux" ? controlName : controlPath,
});

const childExitWait = (target, timeout) => new Promise((resolveWait) => {
  if (target.exitCode !== null || target.signalCode !== null) {
    resolveWait(true);
    return;
  }
  const timer = setTimeout(() => {
    target.removeListener("exit", exited);
    resolveWait(false);
  }, timeout);
  const exited = () => {
    clearTimeout(timer);
    resolveWait(true);
  };
  target.once("exit", exited);
});

const childStop = async () => {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const target = child;
  const exited = childExitWait(target, 5000);
  if (process.platform === "win32") {
    processIdsStop([target.pid]);
  } else {
    try {
      process.kill(-target.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (!await exited) {
    if (process.platform === "win32") {
      processIdsStop([target.pid]);
    } else {
      try {
        process.kill(-target.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (!await childExitWait(target, 5000)) {
      throw new Error(`Failed to stop child process: ${target.pid}`);
    }
  }
};

const ownerStop = () => {
  if (stopPromise) return stopPromise;
  isStopping = true;
  lifecycle = "stopping";
  stopPromise = childStop().then(() => {
    child = undefined;
    lifecycle = "stopped";
    return stateGet();
  });
  return stopPromise;
};

const controlServer = createServer((socket) => {
  let requestText = "";
  let handled = false;
  socket.setEncoding("utf8");
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    if (handled) return;
    requestText += chunk;
    const newlineIndex = requestText.indexOf("\n");
    if (newlineIndex < 0) return;
    handled = true;
    void (async () => {
      const request = JSON.parse(requestText.slice(0, newlineIndex));
      if (request.action === "status") {
        socket.end(`${JSON.stringify({ state: stateGet() })}\n`);
        return;
      }
      if (request.action === "restart") {
        if (!childRestart) {
          socket.end(`${JSON.stringify({ error: `${commandName} is still starting.` })}\n`);
          return;
        }
        socket.end(`${JSON.stringify({ state: await childRestart() })}\n`);
        return;
      }
      if (request.action !== "stop") {
        socket.end(`${JSON.stringify({ error: `Unsupported control action: ${request.action}` })}\n`);
        return;
      }
      const stoppedState = await ownerStop();
      socket.end(`${JSON.stringify({ state: stoppedState })}\n`);
      if (!exitScheduled) {
        exitScheduled = true;
        controlServer.close(() => {
          if (process.platform === "darwin") rmSync(controlPath, { force: true });
          process.exit(0);
        });
      }
    })().catch((error) => {
      socket.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    });
  });
});

const controlAcquire = () => new Promise((resolveAcquire, rejectAcquire) => {
  const onError = (error) => {
    controlServer.removeListener("listening", onListening);
    if (error.code === "EADDRINUSE") {
      resolveAcquire(false);
      return;
    }
    rejectAcquire(error);
  };
  const onListening = () => {
    controlServer.removeListener("error", onError);
    resolveAcquire(true);
  };
  controlServer.once("error", onError);
  controlServer.once("listening", onListening);
  controlServer.listen(controlPath);
});

const controlClose = () => new Promise((resolveClose, rejectClose) => {
  if (!controlServer.listening) {
    if (process.platform === "darwin") rmSync(controlPath, { force: true });
    resolveClose();
    return;
  }
  controlServer.close((error) => {
    if (process.platform === "darwin") rmSync(controlPath, { force: true });
    if (error) rejectClose(error);
    else resolveClose();
  });
});

const acquired = await controlAcquire();
if (!acquired) {
  const runningState = await controlRequest("status");
  if (!runningState) {
    throw new Error(`${commandName} control channel is occupied but its owner did not respond.`);
  }
  statePrint("is already running", runningState);
  process.exit(0);
}

const orphanProcessIds = orphansStop();
if (orphanProcessIds.length > 0) {
  console.log(`${commandName} removed ${orphanProcessIds.length} orphan process${orphanProcessIds.length === 1 ? "" : "es"}`);
}

const childCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const childArgs = [
  "exec",
  "vite",
  "--config",
  entry,
  "--configLoader",
  "runner",
  ...passthroughArgs,
];
const ownerExit = async (exitCode) => {
  if (exitScheduled) return;
  exitScheduled = true;
  try {
    await ownerStop();
    await controlClose();
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

process.once("SIGINT", () => void ownerExit(130));
process.once("SIGTERM", () => void ownerExit(143));

const childStart = () => {
  child = spawn(childCommand, childArgs, {
    env: {
      ...process.env,
      ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
    },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  child.once("error", (error) => {
    console.error(error.message);
    void ownerExit(1);
  });

  child.once("exit", (code, signal) => {
    if (isStopping) return;
    void (async () => {
      await controlClose();
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    })();
  });

  lifecycle = "running";
  return stateGet();
};

childRestart = async () => {
  isStopping = true;
  lifecycle = "restarting";
  await childStop();
  child = undefined;
  stopPromise = undefined;
  isStopping = false;
  return childStart();
};

if (!isStopping) {
  statePrint("started", childStart());
}
