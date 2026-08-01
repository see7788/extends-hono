import { serve, type ServerType } from "@hono/node-server";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { createConnection, createServer, type Server as ControlServer } from "node:net";
import router, { dispose as routerDispose } from "./index.tsx";
import { z } from "zod";

const stateSchema = z.object({
  control: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  status: z.literal("running"),
  url: z.string().url(),
}).strict();

export type WindowsNamedPipeState = z.infer<typeof stateSchema>;

type Owner = {
  control: ControlServer;
  http: ServerType;
  state: WindowsNamedPipeState;
};

const instanceId = createHash("sha256").update(homedir().toLowerCase()).digest("hex").slice(0, 16);
const controlPath = `\\\\.\\pipe\\windows-named-pipe-dashboard-${instanceId}`;
let owner: Owner | undefined;
let starting: Promise<WindowsNamedPipeState> | undefined;

const stateRequest = () => new Promise<WindowsNamedPipeState | undefined>((resolve, reject) => {
  let responseText = "";
  let settled = false;
  const socket = createConnection(controlPath);
  const settle = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timeout);
    return true;
  };
  const timeout = setTimeout(() => {
    socket.destroy();
    if (settle()) reject(new Error(`Windows Named Pipe state request timed out: ${controlPath}`));
  }, 1000);
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.write(`${JSON.stringify({ action: "status" })}\n`));
  socket.on("data", chunk => {
    responseText += chunk;
    const newlineIndex = responseText.indexOf("\n");
    if (newlineIndex < 0) return;
    try {
      const response = JSON.parse(responseText.slice(0, newlineIndex)) as { error?: unknown; state?: unknown };
      if (response.error) throw new Error(String(response.error));
      socket.end();
      if (settle()) resolve(stateSchema.parse(response.state));
    } catch (error) {
      socket.destroy();
      if (settle()) reject(error);
    }
  });
  socket.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
      if (settle()) resolve(undefined);
      return;
    }
    if (settle()) reject(error);
  });
  socket.once("close", () => {
    if (settle()) reject(new Error(`Windows Named Pipe state connection closed: ${controlPath}`));
  });
});

const controlAcquire = (control: ControlServer) => new Promise<boolean>((resolve, reject) => {
  const error = (cause: NodeJS.ErrnoException) => {
    control.off("listening", listening);
    if (cause.code === "EADDRINUSE") resolve(false);
    else reject(cause);
  };
  const listening = () => {
    control.off("error", error);
    resolve(true);
  };
  control.once("error", error);
  control.once("listening", listening);
  control.listen(controlPath);
});

const remoteStateWait = async () => {
  let cause: unknown;
  for (let index = 0; index < 200; index += 1) {
    try {
      const state = await stateRequest();
      if (state) return state;
    } catch (error) {
      cause = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Windows Named Pipe owner did not publish a running state", { cause });
};

const ownerStart = async () => {
  let state: WindowsNamedPipeState | undefined;
  const control = createServer(socket => {
    let requestText = "";
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", chunk => {
      requestText += chunk;
      const newlineIndex = requestText.indexOf("\n");
      if (newlineIndex < 0) return;
      try {
        const request = JSON.parse(requestText.slice(0, newlineIndex)) as { action?: unknown };
        if (request.action !== "status") throw new Error(`Unsupported action: ${String(request.action)}`);
        if (!state) throw new Error("Windows Named Pipe service is starting");
        socket.end(`${JSON.stringify({ state })}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
      }
    });
  });
  if (!await controlAcquire(control)) return remoteStateWait();

  try {
    const http = await new Promise<ServerType>((resolve, reject) => {
      const server = serve({ fetch: router.fetch, hostname: "127.0.0.1", port: 0 }, info => resolve(server));
      server.once("error", reject);
    });
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Windows Named Pipe HTTP server has no TCP address");
    state = {
      control: controlPath,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      status: "running",
      url: `http://127.0.0.1:${String(address.port)}/node-service`,
    };
    owner = { control, http, state };
    return state;
  } catch (error) {
    control.close();
    throw error;
  }
};

export const running = async () => {
  if (process.platform !== "win32") throw new Error("Windows Named Pipe service requires Windows");
  if (owner) return owner.state;
  const current = await stateRequest();
  if (current) return current;
  starting ??= ownerStart().finally(() => {
    starting = undefined;
  });
  return starting;
};

export const close = async () => {
  const current = owner;
  owner = undefined;
  if (!current) return;
  const results = await Promise.allSettled([
    new Promise<void>((resolve, reject) => current.control.close(error => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => current.http.close(error => error ? reject(error) : resolve())),
  ]);
  routerDispose();
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, "Windows Named Pipe service close failed");
};
