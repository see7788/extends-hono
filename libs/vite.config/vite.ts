import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
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
  port: number;
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

const portAvailable = (hostname: string, port: number) => new Promise<boolean>((resolvePort) => {
  const server = createNetServer();
  server.once("error", () => resolvePort(false));
  server.listen(port, hostname, () => {
    server.close(error => resolvePort(!error));
  });
});

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
  const honoName = packageName(cwd);
  const projects: ReactProject[] = reactRoots.map((reactRoot) => {
    const root = resolve(cwd, reactRoot);
    const configFile = join(root, "vite.config.ts");
    if (!existsSync(configFile)) throw new Error(`React Vite config not found: ${configFile}`);
    return { configFile, name: packageName(root), port: 0, root };
  });
  if (new Set(projects.map(project => project.name)).size !== projects.length) {
    throw new Error("React package names must be unique");
  }
  if (configEnv.command === "serve") {
    let port = 5173;
    for (const project of projects) {
      while (port === honoPort || !await portAvailable(hostname, port)) port += 1;
      project.port = port;
      port += 1;
    }
  }

  const [primaryProject, ...secondaryProjects] = projects;
  const primaryConfig = await loadConfigFromFile(
    configEnv,
    primaryProject.configFile,
    primaryProject.root,
  );
  if (!primaryConfig) throw new Error(`Cannot load React Vite config: ${primaryProject.configFile}`);

  let honoProcess: ChildProcess | undefined;
  let isClosing = false;
  const secondaryServers: ViteDevServer[] = [];
  const lifecycle: Plugin = {
    name: "honoreact-lifecycle",
    configResolved(config) {
      if (config.server.ws !== false) {
        config.server.ws = {
          ...config.server.ws,
          clientPort: config.server.port,
          host: hostname,
        };
      }
    },
    configureServer(primaryServer) {
      const developmentFail = (message: string) => {
        if (isClosing) return;
        primaryServer.config.logger.error(message);
        process.exitCode = 1;
        void primaryServer.close();
      };
      primaryServer.httpServer?.once("listening", () => {
        void (async () => {
          for (const project of secondaryProjects) {
            const server = await createServer({
              base: `/${project.name}/`,
              configFile: project.configFile,
              mode: configEnv.mode,
              root: project.root,
              server: {
                host: hostname,
                port: project.port,
                strictPort: true,
                ws: { clientPort: project.port, host: hostname },
              },
            });
            secondaryServers.push(server);
            if (isClosing) return server.close();
            await server.listen();
            server.printUrls();
          }
          const servers = [primaryServer, ...secondaryServers];
          const env = {
            ...process.env,
            ...Object.fromEntries(projects.map((project, index) => [
              `HONOREACT_URL_${project.name}`,
              developmentUrl(servers[index]),
            ])),
            HONOREACT_NAMES: projects.map(project => project.name).join(","),
            NODE_ENV: "development",
          };
          await new Promise<void>((resolveAddress, rejectAddress) => {
            const addressServer = createNetServer();
            addressServer.once("error", (error: NodeJS.ErrnoException) => {
              rejectAddress(error.code === "EADDRINUSE"
                ? new Error(`Hono address ${hostname}:${String(honoPort)} is already in use`)
                : error);
            });
            addressServer.listen(honoPort, hostname, () => {
              addressServer.close(error => error ? rejectAddress(error) : resolveAddress());
            });
          });
          honoProcess = spawn(
            process.execPath,
            ["--import", pathToFileURL(createRequire(entry).resolve("tsx")).href, entry],
            { cwd, env, stdio: "inherit", windowsHide: true },
          );
          honoProcess.once("error", error => developmentFail(`Hono process failed: ${error.message}`));
          honoProcess.once("exit", (code, signal) => {
            honoProcess = undefined;
            if (isClosing || code === 0) return;
            developmentFail(code === null
              ? `Hono process exited with signal ${signal ?? "unknown"}`
              : `Hono process exited with code ${String(code)}`);
          });
        })().catch((error: unknown) => {
          developmentFail(error instanceof Error ? error.message : String(error));
        });
      });
      primaryServer.httpServer?.once("close", () => {
        isClosing = true;
        honoProcess?.kill();
        void Promise.allSettled(secondaryServers.splice(0).map(server => server.close()));
      });
    },
    async closeBundle() {
      if (configEnv.command !== "build") return;
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
          outDir: resolve(cwd, "dist", honoName),
          rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
          ssr: entry,
          target: "node20",
        },
        configFile: false,
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
        },
        root: cwd,
        ssr: { noExternal: ["vite.config"] },
      });
    },
  };

  return mergeConfig(primaryConfig.config, {
    base: configEnv.command === "build" ? "./" : `/${primaryProject.name}/`,
    ...(configEnv.command === "build" && {
      build: { emptyOutDir: true, outDir: resolve(cwd, "dist", primaryProject.name) },
    }),
    plugins: [lifecycle],
    root: primaryProject.root,
    ...(configEnv.command === "serve" && {
      server: {
        host: hostname,
        port: primaryProject.port,
        strictPort: true,
        ws: { clientPort: primaryProject.port, host: hostname },
      },
    }),
  });
};
