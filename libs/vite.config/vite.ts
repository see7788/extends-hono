import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  build,
  createServer,
  loadConfigFromFile,
  mergeConfig,
  type Plugin,
  type UserConfigExport,
  type ViteDevServer,
} from "vite";

type ReactProject = {
  configFile: string;
  name: string;
  root: string;
};

const packageName = (root: string) => {
  const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
  if (typeof name !== "string" || !/^[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error(`package.json name must be one URL path segment: ${root}`);
  }
  return name;
};

const developmentUrl = (server: ViteDevServer) => {
  const origin = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
  if (!origin) throw new Error("Cannot resolve a React development server URL");
  return new URL(server.config.base, origin).toString();
};

const webSocketPortUse = (server: ViteDevServer) => {
  const address = server.httpServer?.address();
  const webSocket = server.config.server.ws;
  if (address && typeof address !== "string" && webSocket) webSocket.clientPort = address.port;
};

export default (
  {
    honoEntry,
    hostname,
    honoPort,
  }: {
    honoEntry: string;
    hostname: string;
    honoPort: number;
  },
  ...reactRoots: string[]
): UserConfigExport => async (configEnv) => {
  if (isAbsolute(honoEntry) || reactRoots.some(isAbsolute)) {
    throw new Error("honoEntry and reactRoots must be relative to process.cwd()");
  }
  if (reactRoots.length === 0) throw new Error("At least one React root is required");

  const cwd = process.cwd();
  const entry = resolve(cwd, honoEntry);
  if (!existsSync(entry)) throw new Error(`Hono entry not found: ${entry}`);
  const projects: ReactProject[] = reactRoots.map((reactRoot) => {
    const root = resolve(cwd, reactRoot);
    const configFile = join(root, "vite.config.ts");
    if (!existsSync(configFile)) throw new Error(`React Vite config not found: ${configFile}`);
    return { configFile, name: packageName(root), root };
  });
  if (new Set(projects.map(project => project.name)).size !== projects.length) {
    throw new Error("React package names must be unique");
  }

  const [primaryProject, ...secondaryProjects] = projects;
  const primaryConfig = await loadConfigFromFile(configEnv, primaryProject.configFile, primaryProject.root);
  if (!primaryConfig) throw new Error(`Cannot load React Vite config: ${primaryProject.configFile}`);

  if (configEnv.command === "build") {
    for (const project of secondaryProjects) {
      await build({
        base: "./",
        build: { emptyOutDir: true, outDir: resolve(cwd, "dist", project.name) },
        configFile: project.configFile,
        mode: configEnv.mode,
        root: project.root,
      });
    }
    await build({
      build: {
        emptyOutDir: true,
        outDir: resolve(cwd, "dist", packageName(cwd)),
        rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
        ssr: entry,
        target: "node20",
      },
      configFile: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      root: cwd,
      ssr: { noExternal: ["vite.config"] },
    });
    return mergeConfig(primaryConfig.config, {
      base: "./",
      build: { emptyOutDir: true, outDir: resolve(cwd, "dist", primaryProject.name) },
      root: primaryProject.root,
    });
  }

  const vitePort = Math.max(5173, honoPort + 1);
  const secondaryServers: ViteDevServer[] = [];
  let honoProcess: ChildProcess | undefined;
  let closing = false;
  const close = async () => {
    closing = true;
    const processClose = honoProcess
      ? new Promise<void>((resolveClose) => {
          const process = honoProcess!;
          process.once("error", () => resolveClose());
          process.once("exit", () => resolveClose());
          if (!process.kill()) resolveClose();
        })
      : Promise.resolve();
    await Promise.allSettled([
      processClose,
      ...secondaryServers.splice(0).map(server => server.close()),
    ]);
    honoProcess = undefined;
  };
  const lifecycle: Plugin = {
    name: "honoreact",
    configureServer(primaryServer) {
      const fail = (message: string) => {
        if (closing) return;
        primaryServer.config.logger.error(message);
        process.exitCode = 1;
        void primaryServer.close();
      };
      primaryServer.httpServer?.once("listening", () => {
        void (async () => {
          webSocketPortUse(primaryServer);
          for (const project of secondaryProjects) {
            const server = await createServer({
              base: `/${project.name}/`,
              configFile: project.configFile,
              mode: configEnv.mode,
              root: project.root,
              server: {
                host: hostname,
                port: vitePort,
                ws: { host: hostname },
              },
            });
            secondaryServers.push(server);
            if (closing) return server.close();
            await server.listen();
            webSocketPortUse(server);
          }
          const servers = [primaryServer, ...secondaryServers];
          honoProcess = spawn(
            process.execPath,
            ["--import", pathToFileURL(createRequire(entry).resolve("tsx")).href, entry],
            {
              cwd,
              env: {
                ...process.env,
                ...Object.fromEntries(projects.map((project, index) => [
                  `HONOREACT_URL_${project.name}`,
                  developmentUrl(servers[index]),
                ])),
                NODE_ENV: "development",
              },
              stdio: "inherit",
              windowsHide: true,
            },
          );
          honoProcess.once("error", error => fail(`Hono process failed: ${error.message}`));
          honoProcess.once("exit", (code, signal) => {
            honoProcess = undefined;
            if (closing) return;
            fail(code === null
              ? `Hono process exited with signal ${signal ?? "unknown"}`
              : `Hono process exited with code ${String(code)}`);
          });
        })().catch((error: unknown) => {
          fail(error instanceof Error ? error.message : String(error));
        });
      });
    },
    closeBundle: close,
  };

  return mergeConfig(primaryConfig.config, {
    base: `/${primaryProject.name}/`,
    plugins: [lifecycle],
    root: primaryProject.root,
    server: {
      host: hostname,
      port: vitePort,
      ws: { host: hostname },
    },
  });
};
