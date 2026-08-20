import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  normalizePath,
  type Plugin,
  type PluginOption,
  type UserConfig,
} from "vite";

type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type path_t = `.${string}/index.${"ts" | "tsx"}`;

type ports_t = readonly [
  businessPort: number,
  developmentHonoPort: number,
];

type Options = {
  hono: {
    external?: readonly string[];
    path: path_t;
    port: ports_t;
    define?: Readonly<Record<string, Json>>;
  };
  renderer: {
    define?: Readonly<Record<string, Json>>;
    paths: readonly [path_t, ...path_t[]];
  };
};

type ReactProject = {
  entry: string;
  html: string;
  name: string;
  root: string;
};

type ReactProjectSource = Omit<ReactProject, "html">;

const packageName = (root: string): string => {
  const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof name !== "string" || !/^[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error(`package.json name must be one URL path segment: ${root}`);
  }
  return name;
};

const defineValues = (
  define?: Readonly<Record<string, Json>>,
): Record<string, string> => Object.fromEntries(
  Object.entries(define ?? {}).map(([name, value]) => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized === undefined) throw new Error(`define ${name} cannot be serialized`);
    return [name, serialized];
  }),
);

const htmlSource = (project: ReactProject, development: boolean): string => {
  const relativeEntry = normalizePath(relative(dirname(project.html), project.entry));
  const entry = development
    ? `/@fs/${normalizePath(project.entry)}`
    : relativeEntry.startsWith(".") ? relativeEntry : `./${relativeEntry}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${project.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;
};

export default function honoReact2({
  hono: {
    external: honoExternal = [],
    path: honoPath,
    port: ports,
    define: honoDefineInput,
  },
  renderer: {
    define: rendererDefineInput,
    paths: rendererPaths,
  },
}: Options): PluginOption {
  if (
    !honoPath.startsWith(".")
    || isAbsolute(honoPath)
    || rendererPaths.some(path => !path.startsWith(".") || isAbsolute(path))
    || !/\/index\.(?:ts|tsx)$/.test(honoPath)
    || rendererPaths.some(path => !/\/index\.(?:ts|tsx)$/.test(path))
  ) {
    throw new Error(
      "Hono paths must be relative; renderer paths must be relative index.ts or index.tsx entries",
    );
  }
  const [businessPort, developmentHonoPort] = ports;
  if (businessPort === developmentHonoPort) {
    throw new Error("businessPort and developmentHonoPort must be different");
  }
  if (![businessPort, developmentHonoPort].every(port => (
    Number.isInteger(port) && port >= 1 && port <= 65_535
  ))) {
    throw new Error("ports must be integers between 1 and 65535");
  }

  const cwd = process.cwd();
  const host = "127.0.0.1";
  const hono = resolve(cwd, honoPath);
  if (!existsSync(hono) || !statSync(hono).isFile()) {
    throw new Error(`Hono entry not found: ${hono}`);
  }

  const projectSources: ReactProjectSource[] = rendererPaths.map(path => {
    const entry = resolve(cwd, path);
    if (!existsSync(entry) || !statSync(entry).isFile()) {
      throw new Error(`React entry not found: ${entry}`);
    }
    const root = dirname(entry);
    const index = join(root, "index.html");
    if (existsSync(index)) throw new Error(`React project must not provide index.html: ${index}`);
    const name = packageName(root);
    return {
      entry,
      name,
      root,
    };
  });
  if (new Set(projectSources.map(({ name }) => name)).size !== projectSources.length) {
    throw new Error("React package names must be unique");
  }

  let projects: ReactProject[] = [];
  const projectsPrepare = (temporaryRoot: string) => {
    rmSync(temporaryRoot, { recursive: true, force: true });
    projects = projectSources.map(project => ({
      ...project,
      html: join(temporaryRoot, project.name, "index.html"),
    }));
    const publicRoot = join(temporaryRoot, "public");
    let hasPublic = false;
    for (const project of projects) {
      mkdirSync(dirname(project.html), { recursive: true });
      const source = join(project.root, "public");
      if (!existsSync(source) || !statSync(source).isDirectory()) continue;
      cpSync(source, join(publicRoot, project.name), { recursive: true });
      hasPublic = true;
    }
    return { hasPublic, publicRoot };
  };

  const origin = `http://${host}:${String(businessPort)}`;
  const developmentHonoOrigin = `http://${host}:${String(developmentHonoPort)}`;
  const projectNames = projectSources.map(({ name }) => name).join(",");
  const honoDefine = defineValues(honoDefineInput);
  const rendererDefine = defineValues(rendererDefineInput);
  const honoEntry = normalizePath(hono);

  let runtimeReload: (() => Promise<void>) | undefined;
  let runtimeReloading: Promise<void> | undefined;

  const plugin: Plugin = {
    name: "honoreact2",
    enforce: "pre",
    config(_config, { command }) {
      const development = command === "serve";
      const temporaryRoot = resolve(
        cwd,
        "node_modules",
        ".vite",
        "vite-config-lib",
        development ? "development" : "production",
      );
      const { hasPublic, publicRoot } = projectsPrepare(temporaryRoot);
      for (const project of projects) {
        writeFileSync(project.html, htmlSource(project, development), "utf8");
      }
      const common: UserConfig = {
        base: "/",
        publicDir: hasPublic ? publicRoot : false,
        root: temporaryRoot,
      };
      if (development) {
        return {
          ...common,
          appType: "custom",
          environments: {
            client: { consumer: "client", define: rendererDefine },
            ssr: {
              consumer: "server",
              define: {
                ...honoDefine,
                "process.env.HONOREACT_HOST": JSON.stringify(host),
                "process.env.HONOREACT_ORIGIN": JSON.stringify(origin),
                "process.env.HONOREACT_PORT": JSON.stringify(String(developmentHonoPort)),
                "process.env.HONOREACT_PROJECTS": JSON.stringify(projectNames),
                "process.env.NODE_ENV": JSON.stringify("development"),
              },
              resolve: {
                external: [...honoExternal],
                noExternal: ["vite-config-lib"],
              },
            },
          },
          server: {
            fs: { allow: [cwd, ...projects.map(({ root }) => root)] },
            host,
            port: businessPort,
            proxy: {
              "^/(?!@|node_modules/|__vite_ping|__open-in-editor)": developmentHonoOrigin,
            },
            strictPort: true,
          },
        };
      }

      return {
        ...common,
        builder: {},
        environments: {
          client: {
            consumer: "client",
            define: rendererDefine,
            build: {
              emptyOutDir: true,
              outDir: resolve(cwd, "dist"),
              rollupOptions: {
                input: Object.fromEntries(projects.map(({ html, name }) => [name, html])),
              },
            },
          },
          ssr: {
            consumer: "server",
            define: {
              ...honoDefine,
              "process.env.HONOREACT_HOST": JSON.stringify(host),
              "process.env.HONOREACT_ORIGIN": JSON.stringify(origin),
              "process.env.HONOREACT_PORT": JSON.stringify(String(businessPort)),
              "process.env.HONOREACT_PROJECTS": JSON.stringify(projectNames),
              "process.env.NODE_ENV": JSON.stringify("production"),
            },
            resolve: {
              external: [...honoExternal],
              noExternal: ["vite-config-lib"],
            },
            build: {
              emptyOutDir: true,
              outDir: resolve(cwd, "dist", packageName(cwd)),
              rollupOptions: {
                input: honoEntry,
                output: { entryFileNames: "index.js", format: "es" },
              },
              target: "node20",
            },
          },
        },
      };
    },
    async hotUpdate({ modules }) {
      if (this.environment.name !== "ssr" || modules.length === 0 || !runtimeReload) return;
      await runtimeReload();
      return [];
    },
    async configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          await runtimeReloading;
          if (request.method !== "GET" || !request.url) return next();
          const url = new URL(request.url, origin);
          const project = projects.find(({ name }) => (
            url.pathname === `/${name}` || url.pathname.startsWith(`/${name}/`)
          ));
          if (!project) return next();
          if (url.pathname === `/${project.name}`) {
            response.statusCode = 307;
            response.setHeader("Location", `/${project.name}/${url.search}`);
            response.end();
            return;
          }
          if (!request.headers.accept?.includes("text/html")) return next();
          const html = await server.transformIndexHtml(
            url.pathname,
            readFileSync(project.html, "utf8"),
          );
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
      const environment = server.environments.ssr;
      const runner = Reflect.get(environment, "runner") as {
        import: (id: string) => Promise<unknown>;
        clearCache: () => void;
      } | undefined;
      const moduleImport = runner
        ? runner.import.bind(runner) as (id: string) => Promise<Record<string, unknown>>
        : server.ssrLoadModule.bind(server) as (id: string) => Promise<Record<string, unknown>>;
      const moduleClearCache = runner
        ? runner.clearCache.bind(runner)
        : () => undefined;
      type ProjectServer = {
        close(callback?: (error?: Error) => void): void;
        closeAllConnections(): void;
        listening: boolean;
      };
      const serverRead = (loaded: Record<string, unknown>): ProjectServer => {
        const projectServer = loaded.default as Partial<ProjectServer> | undefined;
        if (
          !projectServer
          || typeof projectServer.close !== "function"
          || typeof projectServer.closeAllConnections !== "function"
          || typeof projectServer.listening !== "boolean"
        ) {
          throw new Error("The Hono project entry must default export the Node Server");
        }
        return projectServer as ProjectServer;
      };
      const serverClose = (projectServer: ProjectServer): Promise<void> => {
        if (!projectServer.listening) return Promise.resolve();
        return new Promise((resolveClose, rejectClose) => {
          projectServer.close(error => error ? rejectClose(error) : resolveClose());
          projectServer.closeAllConnections();
        });
      };
      let projectServer = serverRead(await moduleImport(honoEntry));
      let reloadQueue = Promise.resolve();
      runtimeReload = () => {
        const reload = reloadQueue.catch(() => undefined).then(async () => {
          await serverClose(projectServer);
          moduleClearCache();
          projectServer = serverRead(await moduleImport(honoEntry));
        });
        reloadQueue = reload;
        runtimeReloading = reload;
        void reload.finally(() => {
          if (runtimeReloading === reload) runtimeReloading = undefined;
        }).catch(() => undefined);
        return reload;
      };
      server.httpServer?.once("close", () => projectServer.close());
    },
  };

  return [plugin];
}
