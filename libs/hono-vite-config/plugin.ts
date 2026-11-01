import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  viteHtmlEntryUrl,
  viteHtmlMiddleware,
} from "vite-src/public";
import {
  createRunnableDevEnvironment,
  isRunnableDevEnvironment,
  normalizePath,
  type Plugin,
  type UserConfig,
} from "vite";
import { Eta } from "eta";
import { Project, SyntaxKind } from "ts-morph";

export type path_t = `.${string}/index.${"ts" | "tsx"}`;

type Options = {
  hono: {
    external?: readonly string[];
    path: path_t;
    port: readonly [
      businessPort: number,
      developmentHonoPort: number,
    ];
  };
  renderer: {
    paths: readonly [path_t, ...path_t[]];
  };
};

export default function honoReact2({
  hono: {
    external: honoExternal = [],
    path: honoPath,
    port: ports,
  },
  renderer: {
    paths: rendererPaths,
  },
}: Options): Plugin[] {
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
  const projectNames = projectSources.map(({ name }) => JSON.stringify(name)).join(", ");
  const distDirectory = "dist";
  const declareDirectory = join(dirname(hono), "declare");
  const runtimePath = join(declareDirectory, "hono.ts");
  const htmlTemplate = readFileSync(new URL("./index.html", import.meta.url), "utf8")
    .replace(/^\uFEFF/, "");
  const eta = new Eta();
  const honoEntry = normalizePath(hono);
  const runtimeEntry = "virtual:honoreact2:ssr-runtime";
  const runtimeModule = "\0honoreact2:ssr-runtime";
  const runtimeSource = `
import projectServer from ${JSON.stringify(honoEntry)};

const serverRead = (server) => {
  if (
    !server
    || typeof server.close !== "function"
    || typeof server.closeAllConnections !== "function"
    || typeof server.listening !== "boolean"
  ) {
    throw new Error("The Hono project entry must default export the Node Server");
  }
  return server;
};

const server = serverRead(projectServer);
if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(honoEntry)}, module => {
    // A failed transform is already reported by Vite and supplies no module.
    // Keep the last valid application serving instead of turning a source
    // error into a Node process failure.
    if (!module) return;
    let nextServer;
    try {
      nextServer = serverRead(module.default);
    } catch (error) {
      console.error(error);
      return;
    }
    if (nextServer !== server) {
      console.error(new Error(
        "honoServer must preserve the Node Server during a hot update",
      ));
    }
  });
}

export default server;
`;

  const plugin: Plugin = {
    name: "honoreact2",
    enforce: "pre",
    config(_config, { command }) {
      const development = command === "serve";
      const runtimeTemplate = readFileSync(
        new URL(development ? "./hono.development.ts" : "./hono.production.ts", import.meta.url),
        "utf8",
      )
        .replace(/^\uFEFF/, "");
      const runtimeProject = new Project({
        skipFileDependencyResolution: true,
        useInMemoryFileSystem: true,
      });
      const runtimeFile = runtimeProject.createSourceFile("hono.development.ts", runtimeTemplate);
      const runtimeConfig = runtimeFile
        .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
        .find(variable => variable.getName() === "config");
      if (!runtimeConfig) throw new Error("hono-vite-config runtime config is missing");
      const runtimeConfigObject = runtimeConfig
        .getInitializerIfKindOrThrow(SyntaxKind.AsExpression)
        .getExpressionIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      runtimeConfigObject.getPropertyOrThrow("host").replaceWithText(
        `host: ${JSON.stringify(host)}`,
      );
      runtimeConfigObject.getPropertyOrThrow("port").replaceWithText(
        `port: ${String(development ? developmentHonoPort : businessPort)}`,
      );
      runtimeConfigObject.getPropertyOrThrow("origin").replaceWithText(
        `origin: ${JSON.stringify(origin)}`,
      );
      runtimeConfigObject.getPropertyOrThrow("projects").replaceWithText(
        `projects: [${projectNames}] as const`,
      );
      runtimeConfigObject.getPropertyOrThrow("distDirectory").replaceWithText(
        `distDirectory: ${JSON.stringify(distDirectory)}`,
      );
      const honoUrl = runtimeFile
        .getVariableDeclarationOrThrow("honoUrl")
        .getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction);
      const projectType = honoUrl.getTypeParameters()[0];
      if (!projectType) throw new Error("hono-vite-config honoUrl type parameter is missing");
      projectType.setConstraint(projectSources.map(({ name }) => JSON.stringify(name)).join(" | ") || "never");
      const url = honoUrl
        .getDescendantsOfKind(SyntaxKind.NewExpression)
        .find(expression => expression.getExpression().getText() === "URL");
      if (!url) throw new Error("hono-vite-config honoUrl URL expression is missing");
      url.getArguments()[1]?.replaceWithText(JSON.stringify(origin));
      const generatedRuntimeSource = runtimeFile.getFullText().replace(/(?:\r?\n)+$/, "");
      mkdirSync(declareDirectory, { recursive: true });
      writeFileSync(
        runtimePath,
        `\uFEFF${generatedRuntimeSource.replace(/\r?\n/g, "\r\n")}\r\n`,
        "utf8",
      );
      const temporaryRoot = resolve(
        cwd,
        "node_modules",
        ".vite",
        "hono-vite-config",
        development ? "development" : "production",
      );
      const { hasPublic, publicRoot } = projectsPrepare(temporaryRoot);
      for (const project of projects) {
        writeFileSync(
          project.html,
          eta.renderString(htmlTemplate, {
            title: project.name,
            entry: viteHtmlEntryUrl(project.html, project.entry, development ? "serve" : "build"),
          }),
          "utf8",
        );
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
            client: { consumer: "client" },
            ssr: {
              consumer: "server",
              dev: {
                createEnvironment: (name, config) => (
                  createRunnableDevEnvironment(name, config)
                ),
              },
              resolve: {
                external: [...honoExternal],
                noExternal: ["hono-vite-config"],
              },
            },
          },
          server: {
            fs: { allow: [cwd, ...projects.map(({ root }) => root)] },
            host,
            port: businessPort,
            proxy: {
              "^/(?!\\?|@|node_modules/|__vite_ping|__open-in-editor)": {
                target: developmentHonoOrigin,
                ws: true,
              },
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
            build: {
              emptyOutDir: true,
              outDir: resolve(cwd, distDirectory),
              rollupOptions: {
                input: Object.fromEntries(projects.map(({ html, name }) => [name, html])),
              },
            },
          },
          ssr: {
            consumer: "server",
            resolve: {
              external: [...honoExternal],
              noExternal: ["hono-vite-config"],
            },
            build: {
              emptyOutDir: true,
              outDir: resolve(cwd, distDirectory, packageName(cwd)),
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
    resolveId(id) {
      if (id === runtimeEntry) return runtimeModule;
    },
    load(id) {
      if (id === runtimeModule) return runtimeSource;
    },
    hotUpdate(options) {
      if (this.environment.name !== "ssr" || options.modules.length === 0) return;
      const honoModule = this.environment.moduleGraph.getModuleById(honoEntry);
      if (!honoModule) return;
      // Partial invalidation can replay side-effect registrations against a stale generation.
      // Rebuild the SSR graph while the runtime accept boundary preserves the Node listener.
      this.environment.moduleGraph.invalidateAll();
      return [honoModule];
    },
    async configureServer(server) {
      viteHtmlMiddleware(server, projects, origin);
      const environment = server.environments.ssr;
      if (!isRunnableDevEnvironment(environment)) {
        throw new Error("honoreact2 requires a runnable Vite SSR environment");
      }
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
      const projectServer = serverRead(
        await environment.runner.import<Record<string, unknown>>(runtimeEntry),
      );
      server.httpServer?.once("close", () => projectServer.close());
    },
  };

  return [plugin];
}
