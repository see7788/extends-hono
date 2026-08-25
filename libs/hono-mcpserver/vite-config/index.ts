import mcpserver from "mcpserver";
import {
  dependenciesInstallValidator,
  honoReact2Validator,
  honoServerValidator,
  honoUrlValidator,
  importsEnsureValidator,
  projectReadValidator,
  readmeUri,
  viteConfig,
} from "vite-config-lib/index";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const localMutate = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const remoteMutate = { ...localMutate, openWorldHint: true } as const;

export default mcpserver.register
  .slice("viteConfig")
  .resource(
    "get",
    "/readme",
    readmeUri,
    {
      title: "Vite 配置说明",
      description: "读取 Vite 配置工具的使用说明。",
      mimeType: "text/markdown",
    },
    async context =>
      context.json(await viteConfig.readme(context.req.query("uri"))),
  )
  .tool(
    "post",
    "/dependenciesInstall",
    dependenciesInstallValidator,
    "安装 Vite 配置所需的项目依赖。",
    remoteMutate,
    async context => {
      const result = await viteConfig.dependenciesInstall(
        context.req.valid("json"),
      );
      return result.status === 400
        ? context.json(result.body, 400)
        : context.json(result.body);
    },
  )
  .tool(
    "post",
    "/importsEnsure",
    importsEnsureValidator,
    "确保项目包含 Vite 配置所需的导入。",
    localMutate,
    async context => {
      const result = await viteConfig.importsEnsure(context.req.valid("json"));
      return result.status === 400
        ? context.json(result.body, 400)
        : context.json(result.body);
    },
  )
  .tool(
    "post",
    "/projectRead",
    projectReadValidator,
    "读取项目中的 Vite 配置信息。",
    read,
    async context => {
      const result = await viteConfig.projectRead(context.req.valid("json"));
      return result.status === 400
        ? context.json(result.body, 400)
        : context.json(result.body);
    },
  )
  .tool(
    "post",
    "/honoReact2",
    honoReact2Validator,
    "生成 Hono React 2 的 Vite 配置。",
    read,
    context =>
      context.json(viteConfig.honoReact2(context.req.valid("json"))),
  )
  .tool(
    "post",
    "/honoServer",
    honoServerValidator,
    "生成 Hono 服务端的 Vite 配置。",
    read,
    context => context.json(viteConfig.honoServer(context.req.valid("json"))),
  )
  .tool(
    "post",
    "/honoUrl",
    honoUrlValidator,
    "生成 Hono 服务地址的 Vite 配置。",
    read,
    context => context.json(viteConfig.honoUrl(context.req.valid("json"))),
  );
