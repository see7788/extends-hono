import devServer, { defaultOptions } from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  entry: string;
  index: string;
  name: string;
  root: string;
};

type json_t = null | boolean | number | string | readonly json_t[] | {
  readonly [key: string]: json_t;
};

type path_t = `.${string}`;
type rendererPath_t = `.${string}/index.tsx`;

type honoReactPlugin_t = {
  hono: {
    external?: readonly string[];
    path: path_t;
    port: number;
    define?: Readonly<Record<string, json_t>>;
  };
  renderer: readonly [
    define: Readonly<Record<string, json_t>>,
    path: rendererPath_t,
    ...paths: rendererPath_t[],
  ];
};

const packageName = (root: string) => {
  const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof name !== "string" || !/^[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error(`package.json name must be one URL path segment: ${root}`);
  }
  return name;
};

const defineValues = (define?: Record<string, unknown>) => Object.fromEntries(
  Object.entries(define ?? {}).map(([name, value]) => {
    if (typeof value === "string") return [name, value];
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`define ${name} cannot be serialized`);
    return [name, serialized];
  }),
);

const fileInside = (root: string, path: string) => {
  const file = resolve(root, path);
  return relative(root, file).split(/[\\/]/).includes("..")
    || !existsSync(file)
    || !statSync(file).isFile()
    ? undefined
    : file;
};

const htmlSource = (project: ReactProject, development = false) => [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  `  <title>${project.name}</title>`,
  "</head>",
  "<body>",
  '  <div id="root"></div>',
  `  <script type="module" src="${development ? `/${project.name}/index.tsx` : "/index.tsx"}"></script>`,
  "</body>",
  "</html>",
].join("\n");

const htmlCreate = (project: ReactProject) => {
  if (existsSync(project.index)) {
    throw new Error(`React project must not provide index.html: ${project.index}`);
  }
  writeFileSync(project.index, htmlSource(project));
};

const htmlRemove = (project: ReactProject) => rmSync(project.index, { force: true });

const transformProject = async (project: ReactProject, code: string, id: string) => {
  const file = normalizePath(id.split("?")[0]);
  const root = normalizePath(project.root);
  if ((file !== root && !file.startsWith(`${root}/`)) || !/\.[cm]?[jt]sx?$/.test(file)) return;
  const result = await transformWithOxc(code, file, {
    define: project.define,
    jsx: "preserve",
    sourcemap: true,
    target: "esnext",
  });
  return { code: result.code, map: result.map };
};

export default function honoReact2({
  hono: { external: honoExternal = [], path: honoPath, port, define: honoDefineInput },
  renderer: [rendererDefineInput, ...rendererPaths],
}: honoReactPlugin_t): Plugin[] {
  if (
    !honoPath.startsWith(".")
    || rendererPaths.some(projectPath => !projectPath.startsWith("."))
    || rendererPaths.some(projectPath => !projectPath.endsWith("/index.tsx"))
    || isAbsolute(honoPath)
    || rendererPaths.some(projectPath => isAbsolute(projectPath))
  ) {
    throw new Error("Hono paths must be relative; React paths must be relative and end with /index.tsx");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("port must be an integer between 1 and 65535");
  }

  const cwd = process.cwd();
  const host = "127.0.0.1";
  const hono = resolve(cwd, honoPath);
  const honoDefine = defineValues(honoDefineInput);
  const rendererDefine = defineValues(rendererDefineInput);
  if (!existsSync(hono)) throw new Error(`Hono entry not found: ${hono}`);
  const projects = rendererPaths.map(projectPath => {
    const entry = resolve(cwd, projectPath);
    const root = dirname(entry);
    const index = join(root, "index.html");
    if (!existsSync(entry)) throw new Error(`React entry not found: ${entry}`);
    return { define: rendererDefine, entry, index, name: packageName(root), root };
  });
  if (new Set(projects.map(project => project.name)).size !== projects.length) {
    throw new Error("React package names must be unique");
  }

  const [primary, ...secondary] = projects;
  const origin = new URL(
    `http://${host}:${String(port)}`,
  ).origin;
  const ssrEntry = "virtual:honoreact2:ssr-entry";
  const ssrModule = "\0honoreact2:ssr-entry";
  const ssrSource = `import app from ${JSON.stringify(normalizePath(hono))};\nimport { honoServer } from "vite-config-lib/hono";\nhonoServer(app);`;
  let command: "build" | "serve";
  let sharedConfig: UserConfig = {};
  let buildPlugins: PluginOption[] = [];
  let building = false;

  const projectBuild = async (project: ReactProject) => {
    htmlCreate(project);
    try {
      await build(mergeConfig(sharedConfig, {
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
    } finally {
      htmlRemove(project);
    }
  };

  const honoDevPlugin = devServer({
    adapter: nodeAdapter(),
    entry: hono,
    exclude: defaultOptions.exclude.filter(pattern => !(
      pattern instanceof RegExp && pattern.source === "^\\/favicon\\.ico$"
    )),
  });

  const plugin: Plugin = {
    name: "honoreact2",
    enforce: "pre",
    config(config, configEnv) {
      command = configEnv.command;
      const { plugins = [], ...withoutPlugins } = config;
      sharedConfig = withoutPlugins;
      buildPlugins = plugins.map(option => option === plugin || option === honoDevPlugin ? false : option);
      if (command === "serve") {
        return {
          appType: "custom",
          root: cwd,
          server: {
            fs: { allow: [cwd, ...projects.map(project => project.root)] },
            host,
            port,
            strictPort: true,
          },
        };
      }
      htmlCreate(primary);
      return {
        base: `/${primary.name}/`,
        build: {
          emptyOutDir: true,
          outDir: resolve(cwd, "dist", primary.name),
          rollupOptions: { input: primary.index },
        },
        define: primary.define,
        root: primary.root,
      };
    },
    transform(code, id) {
      if (command !== "serve") return;
      const file = normalizePath(id.split("?")[0]);
      if (file === normalizePath(hono)) {
        return transformWithOxc(code, file, {
          define: honoDefine,
          jsx: "preserve",
          sourcemap: true,
          target: "esnext",
        }).then(result => ({ code: result.code, map: result.map }));
      }
      const project = projects.find(({ root }) => {
        const projectRoot = normalizePath(root);
        return file === projectRoot || file.startsWith(`${projectRoot}/`);
      });
      return project && transformProject(project, code, id);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          if (!request.url || request.method !== "GET") return next();
          const requestUrl = new URL(request.url, origin);
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
          const projectPath = decodeURIComponent(requestUrl.pathname.slice(project.name.length + 2));
          const file = fileInside(project.root, projectPath)
            ?? fileInside(join(project.root, "public"), projectPath);
          if (file) {
            request.url = `/@fs/${normalizePath(file)}${requestUrl.search}`;
            return next();
          }
          if (projectPath && !request.headers.accept?.includes("text/html")) return next();
          const source = htmlSource(project, true);
          const html = await server.transformIndexHtml(requestUrl.pathname, source);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
    buildEnd(error) {
      if (error) htmlRemove(primary);
    },
    async closeBundle() {
      if (command === "serve" || building) return;
      building = true;
      try {
        for (const project of secondary) await projectBuild(project);
        await build({
          build: {
            emptyOutDir: true,
            outDir: resolve(cwd, "dist", packageName(cwd)),
            rollupOptions: {
              input: ssrEntry,
              output: { entryFileNames: "index.js", format: "es" },
            },
            ssr: true,
            target: "node20",
          },
          configFile: false,
          define: {
            ...honoDefine,
            "process.env.HONOREACT_HOST": JSON.stringify(host),
            "process.env.HONOREACT_ORIGIN": JSON.stringify(origin),
            "process.env.HONOREACT_PORT": JSON.stringify(String(port)),
            "process.env.HONOREACT_PROJECTS": JSON.stringify(projects.map(project => project.name).join(",")),
            "process.env.NODE_ENV": JSON.stringify("production"),
          },
          plugins: [{
            name: "honoreact2-ssr-entry",
            resolveId: id => id === ssrEntry ? ssrModule : undefined,
            load: id => id === ssrModule
              ? ssrSource
              : undefined,
          }],
          root: cwd,
          ssr: {
            external: [...honoExternal],
            noExternal: ["vite-config-lib"],
          },
        });
      } finally {
        htmlRemove(primary);
      }
    },
  };

  return [plugin, honoDevPlugin];
}
