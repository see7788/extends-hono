import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer as createNetServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  build,
  mergeConfig,
  normalizePath,
  transformWithOxc,
  type Plugin,
  type PluginOption,
  type UserConfig,
} from "vite";

type ReactProject = {
  define: Record<string, string>;
  index: string;
  name: string;
  root: string;
};

type HonoRuntime = {
  child: ChildProcess;
  exitClose: () => void;
  hangupClose: () => void;
};

const runtimeKey = Symbol.for("vite.config/honoreact");
const runtimeGlobal = globalThis as unknown as Record<symbol, HonoRuntime | undefined>;

const childClose = (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolveClose, rejectClose) => {
    const close = () => {
      child.once("error", rejectClose);
      child.once("exit", () => resolveClose());
      if (!child.kill()) rejectClose(new Error("Failed to stop the Hono child process."));
    };
    if (process.platform !== "win32" || child.pid === undefined) return close();
    const taskkill = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
    );
    taskkill.once("error", rejectClose);
    taskkill.once("exit", code => {
      if (code === 0) resolveClose();
      else rejectClose(new Error(`taskkill exited with code ${String(code)}.`));
    });
  });
};

const childCloseSync = (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`taskkill exited with code ${String(result.status)}.`);
    }
    return;
  }
  if (!child.kill()) throw new Error("Failed to stop the Hono child process.");
};

const packageName = (root: string) => {
  const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
  if (typeof name !== "string" || !/^[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error(`package.json name must be one URL path segment: ${root}`);
  }
  return name;
};

const httpOrigin = (host: string, port: number) => {
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return new URL(`http://${urlHost}:${String(port)}`).origin;
};

const portAvailable = (host: string, port: number) => new Promise<boolean>(resolvePort => {
  const probe = createNetServer();
  probe.unref();
  probe.once("error", () => resolvePort(false));
  probe.listen(port, host, () => probe.close(() => resolvePort(true)));
});

const portReady = (child: ChildProcess, host: string, port: number) => new Promise<void>(
  (resolvePort, rejectPort) => {
    let complete = false;
    const finish = (error?: Error) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      child.off("error", childError);
      child.off("exit", childExit);
      if (error) rejectPort(error);
      else resolvePort();
    };
    const childError = (error: Error) => finish(
      new Error(`Hono process failed before listening: ${error.message}`),
    );
    const childExit = (code: number | null, signal: NodeJS.Signals | null) => finish(
      new Error(code === null
        ? `Hono process exited with signal ${signal ?? "unknown"} before listening`
        : `Hono process exited with code ${String(code)} before listening`),
    );
    const probe = () => {
      if (complete) return;
      const socket = createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(probe, 25);
      });
    };
    const timeout = setTimeout(
      () => finish(new Error(`Hono process did not listen on ${host}:${String(port)} within 10 seconds`)),
      10_000,
    );
    child.once("error", childError);
    child.once("exit", childExit);
    probe();
  },
);

const projectDefine = (define?: Record<string, unknown>) => Object.fromEntries(
  Object.entries(define ?? {}).map(([name, value]) => {
    if (typeof value === "string") return [name, value];
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`define ${name} cannot be serialized`);
    return [name, serialized];
  }),
);

const projectTransform = async (project: ReactProject, code: string, id: string) => {
  const file = normalizePath(id.split("?")[0]);
  const root = normalizePath(project.root);
  if (
    (file !== root && !file.startsWith(`${root}/`))
    || !/\.[cm]?[jt]sx?$/.test(file)
  ) {
    return;
  }
  const result = await transformWithOxc(code, file, {
    define: project.define,
    jsx: "preserve",
    sourcemap: true,
    target: "esnext",
  });
  return { code: result.code, map: result.map };
};

export default function honoReact(
  {
    honoEntry,
    honoHost,
    honoPort,
  }: {
    honoEntry: string;
    honoHost: string;
    honoPort: [mainPort: number, otherPort: number];
  },
  ...reactPkg: [path: string, define?: Record<string, unknown>][]
): Plugin {
  if (isAbsolute(honoEntry) || reactPkg.some(([path]) => isAbsolute(path))) {
    throw new Error("honoEntry and React roots must be relative to process.cwd()");
  }
  if (reactPkg.length === 0) throw new Error("At least one React project is required");

  const cwd = process.cwd();
  const entry = resolve(cwd, honoEntry);
  if (!existsSync(entry)) throw new Error(`Hono entry not found: ${entry}`);
  const [mainPort, otherPort] = honoPort;
  if (mainPort === otherPort) throw new Error("mainPort and otherPort must be different");
  const projects = reactPkg.map(([path, define]) => {
    const root = resolve(cwd, path);
    const index = join(root, "index.html");
    if (!existsSync(index)) throw new Error(`React index.html not found: ${index}`);
    return { define: projectDefine(define), index, name: packageName(root), root };
  });
  if (new Set(projects.map(project => project.name)).size !== projects.length) {
    throw new Error("React package names must be unique");
  }

  const [primaryProject, ...secondaryProjects] = projects;
  const mainOrigin = httpOrigin(honoHost, mainPort);
  const otherOrigin = httpOrigin(honoHost, otherPort);
  let runtime: HonoRuntime | undefined;
  let closing = false;
  let command: "build" | "serve";
  let sharedConfig: UserConfig = {};
  let buildPlugins: PluginOption[] = [];
  let buildCompleting = false;

  const close = async () => {
    closing = true;
    const current = runtime;
    runtime = undefined;
    if (!current) return;
    if (runtimeGlobal[runtimeKey] === current) runtimeGlobal[runtimeKey] = undefined;
    process.off("exit", current.exitClose);
    process.off("SIGHUP", current.hangupClose);
    await childClose(current.child);
  };

  const projectBuild = (project: ReactProject) => build(mergeConfig(sharedConfig, {
    base: `/${project.name}/`,
    build: {
      emptyOutDir: true,
      outDir: resolve(cwd, "dist", project.name),
      rollupOptions: { input: project.index },
    },
    configFile: false,
    define: project.define,
    plugins: buildPlugins,
    root: project.root,
  }));

  const plugin: Plugin = {
    name: "honoreact",
    enforce: "pre",
    config(config, configEnv) {
      command = configEnv.command;
      const { plugins = [], ...configWithoutPlugins } = config;
      sharedConfig = configWithoutPlugins;
      buildPlugins = plugins.map(option => option === plugin ? false : option);
      if (configEnv.command === "serve") {
        return {
          appType: "custom",
          root: cwd,
          server: {
            fs: { allow: projects.map(project => project.root) },
            host: honoHost,
            port: mainPort,
            proxy: {
              "^/(?!@|node_modules/|__vite_ping|__open-in-editor)": {
                target: otherOrigin,
              },
            },
            strictPort: true,
          },
        };
      }
      return {
        base: `/${primaryProject.name}/`,
        build: { emptyOutDir: true, outDir: resolve(cwd, "dist", primaryProject.name) },
        define: primaryProject.define,
        root: primaryProject.root,
      };
    },
    transform(code, id) {
      if (command !== "serve") return;
      const file = normalizePath(id.split("?")[0]);
      const project = projects.find(({ root }) => {
        const projectRoot = normalizePath(root);
        return file === projectRoot || file.startsWith(`${projectRoot}/`);
      });
      if (project) return projectTransform(project, code, id);
    },
    async configureServer(server) {
      const fail = (message: string) => {
        if (closing) return;
        server.config.logger.error(message);
        process.exitCode = 1;
        server.close().catch(error => {
          server.config.logger.error(
            `Vite server close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exitCode = 1;
        });
      };
      const previous = runtimeGlobal[runtimeKey];
      if (previous) {
        runtimeGlobal[runtimeKey] = undefined;
        process.off("exit", previous.exitClose);
        process.off("SIGHUP", previous.hangupClose);
        await childClose(previous.child);
      }
      if (!await portAvailable(honoHost, otherPort)) {
        throw new Error(`otherPort ${String(otherPort)} is already in use`);
      }

      server.middlewares.use(async (request, response, next) => {
        try {
          if (!request.url || request.method !== "GET") return next();
          const requestUrl = new URL(request.url, mainOrigin);
          const project = projects.find(({ name }) => (
            requestUrl.pathname === `/${name}` || requestUrl.pathname.startsWith(`/${name}/`)
          ));
          if (!project) return next();
          if (requestUrl.pathname === `/${project.name}`) {
            response.statusCode = 307;
            response.setHeader("Location", `/${project.name}/${requestUrl.search}`);
            response.end();
            return;
          }

          const projectPath = decodeURIComponent(
            requestUrl.pathname.slice(project.name.length + 2),
          );
          for (const root of [project.root, join(project.root, "public")]) {
            const file = resolve(root, projectPath);
            if (
              relative(root, file).split(/[\\/]/).includes("..")
              || !existsSync(file)
              || !statSync(file).isFile()
            ) {
              continue;
            }
            request.url = `/@fs/${normalizePath(file)}${requestUrl.search}`;
            return next();
          }

          if (
            projectPath !== ""
            && !request.headers.accept?.includes("text/html")
          ) {
            return next();
          }
          const source = readFileSync(project.index, "utf8").replace(
            /(\b(?:src|href)=["'])\/(?!\/)/g,
            `$1/${project.name}/`,
          );
          const html = await server.transformIndexHtml(requestUrl.pathname, source);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
      const child = spawn(
        process.execPath,
        [createRequire(entry).resolve("tsx/cli"), "watch", entry],
        {
          cwd,
          env: {
            ...process.env,
            HONOREACT_HOST: honoHost,
            HONOREACT_ORIGIN: mainOrigin,
            HONOREACT_PORT: String(otherPort),
            HONOREACT_PROJECTS: projects.map(project => project.name).join(","),
            NODE_ENV: "development",
          },
          stdio: "inherit",
          windowsHide: true,
        },
      );
      const exitClose = () => childCloseSync(child);
      const hangupClose = () => {
        process.off("exit", exitClose);
        childCloseSync(child);
        process.exit();
      };
      runtime = { child, exitClose, hangupClose };
      runtimeGlobal[runtimeKey] = runtime;
      process.once("exit", exitClose);
      process.once("SIGHUP", hangupClose);
      try {
        await portReady(child, honoHost, otherPort);
      } catch (startError) {
        process.off("exit", exitClose);
        process.off("SIGHUP", hangupClose);
        if (runtime?.child === child) runtime = undefined;
        if (runtimeGlobal[runtimeKey]?.child === child) runtimeGlobal[runtimeKey] = undefined;
        try {
          await childClose(child);
        } catch (closeError) {
          throw new AggregateError(
            [startError, closeError],
            "Hono process failed to start and close.",
          );
        }
        throw startError;
      }
      child.once("error", error => fail(`Hono process failed: ${error.message}`));
      child.once("exit", (code, signal) => {
        process.off("exit", exitClose);
        process.off("SIGHUP", hangupClose);
        if (runtime?.child === child) runtime = undefined;
        if (runtimeGlobal[runtimeKey]?.child === child) runtimeGlobal[runtimeKey] = undefined;
        if (closing) return;
        fail(code === null
          ? `Hono process exited with signal ${signal ?? "unknown"}`
          : `Hono process exited with code ${String(code)}`);
      });
    },
    async closeBundle() {
      if (command === "serve") {
        await close();
        return;
      }
      if (buildCompleting) return;
      buildCompleting = true;
      for (const project of secondaryProjects) await projectBuild(project);
      await build({
        build: {
          emptyOutDir: true,
          outDir: resolve(cwd, "dist", packageName(cwd)),
          rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
          ssr: entry,
          target: "node20",
        },
        configFile: false,
        define: {
          "process.env.HONOREACT_HOST": JSON.stringify(honoHost),
          "process.env.HONOREACT_ORIGIN": JSON.stringify(mainOrigin),
          "process.env.HONOREACT_PORT": JSON.stringify(String(mainPort)),
          "process.env.HONOREACT_PROJECTS": JSON.stringify(projects.map(project => project.name).join(",")),
          "process.env.NODE_ENV": JSON.stringify("production"),
        },
        root: cwd,
        ssr: { noExternal: ["vite-config-lib"] },
      });
    },
  };

  return plugin;
}
