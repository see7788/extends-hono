import devServer, { defaultOptions } from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import { existsSync, readFileSync, statSync } from "node:fs";
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

const packageName = (root: string) => {
  const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof name !== "string" || !/^[A-Za-z0-9._~-]+$/.test(name)) {
    throw new Error(`package.json name must be one URL path segment: ${root}`);
  }
  return name;
};

const httpOrigin = (host: string, port: number) => {
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return new URL(`http://${urlHost}:${String(port)}`).origin;
};

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

export default function honoReact2(
  {
    honoEntry,
    nodeEntry,
    honoHost,
    honoPort,
  }: {
    honoEntry: string;
    nodeEntry: string;
    honoHost: string;
    honoPort: number;
  },
  ...reactPkg: [path: string, define?: Record<string, unknown>][]
): Plugin[] {
  if (
    isAbsolute(honoEntry)
    || isAbsolute(nodeEntry)
    || reactPkg.some(([path]) => isAbsolute(path))
  ) {
    throw new Error("Hono, Node and React paths must be relative to process.cwd()");
  }
  if (reactPkg.length === 0) throw new Error("At least one React project is required");

  const cwd = process.cwd();
  const hono = resolve(cwd, honoEntry);
  const node = resolve(cwd, nodeEntry);
  if (!existsSync(hono)) throw new Error(`Hono entry not found: ${hono}`);
  if (!existsSync(node)) throw new Error(`Node entry not found: ${node}`);

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
  const origin = httpOrigin(honoHost, honoPort);
  let command: "build" | "serve";
  let sharedConfig: UserConfig = {};
  let buildPlugins: PluginOption[] = [];
  let buildCompleting = false;

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
      const { plugins = [], ...configWithoutPlugins } = config;
      sharedConfig = configWithoutPlugins;
      buildPlugins = plugins.map(option => (
        option === plugin || option === honoDevPlugin ? false : option
      ));
      if (configEnv.command === "serve") {
        return {
          appType: "custom",
          root: cwd,
          server: {
            fs: { allow: [cwd, ...projects.map(project => project.root)] },
            host: honoHost,
            port: honoPort,
            strictPort: true,
          },
        };
      }
      return {
        base: `/${primaryProject.name}/`,
        build: {
          emptyOutDir: true,
          outDir: resolve(cwd, "dist", primaryProject.name),
        },
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
    resolveId(id) {
      if (command !== "serve") return;
      const requestPath = id.split("?")[0];
      const project = projects.find(({ name }) => requestPath.startsWith(`/${name}/`));
      if (!project) return;
      const file = resolve(
        project.root,
        decodeURIComponent(requestPath.slice(project.name.length + 2)),
      );
      if (
        relative(project.root, file).split(/[\\/]/).includes("..")
        || !existsSync(file)
        || !statSync(file).isFile()
      ) {
        return;
      }
      return file;
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
    },
    async closeBundle() {
      if (command === "serve" || buildCompleting) return;
      buildCompleting = true;
      for (const project of secondaryProjects) await projectBuild(project);
      await build({
        build: {
          emptyOutDir: true,
          outDir: resolve(cwd, "dist", packageName(cwd)),
          rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
          ssr: node,
          target: "node20",
        },
        configFile: false,
        define: {
          "process.env.HONOREACT_HOST": JSON.stringify(honoHost),
          "process.env.HONOREACT_ORIGIN": JSON.stringify(origin),
          "process.env.HONOREACT_PORT": JSON.stringify(String(honoPort)),
          "process.env.HONOREACT_PROJECTS": JSON.stringify(
            projects.map(project => project.name).join(","),
          ),
          "process.env.NODE_ENV": JSON.stringify("production"),
        },
        root: cwd,
        ssr: { noExternal: ["vite-config-lib"] },
      });
    },
  };

  return [plugin, honoDevPlugin];
}
