import mcpserver from "mcpserver";
import store from "../store";
import {
  dependenciesInstallValidator,
  honoReact2Validator,
  honoServerValidator,
  honoUrlValidator,
  importsEnsureValidator,
  projectReadValidator,
  readmeUri,
} from "./store";

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const mutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
export default mcpserver
  .register({ sliceName: "vite-config" })
  .resource.register("get", "/readme", readmeUri, {
    title: "vite-config-lib Hono README",
    description: "Authoritative black-box integration contract for vite-config-lib in Hono Vite projects",
    mimeType: "text/markdown",
  }, async context => context.json(await store.getState().viteConfigActions.readme(context.req.query("uri"))))
  .tool.register("post", "/dependencies/install", dependenciesInstallValidator, "为具体 Hono application 合并 vite-config-lib 及其实际使用的 peer dependencies，并在该 package 目录执行 pnpm install。", mutationAnnotations, async context => {
    const result = await store.getState().viteConfigActions.dependenciesInstall(context.req.valid("json"));
    return result.status === 400 ? context.json(result.body, 400) : context.json(result.body);
  })
  .tool.register("post", "/imports/ensure", importsEnsureValidator, "按 honoReact2、honoServer 或 honoUrl 文件角色，为项目内已有 TypeScript 文件补齐 vite-config-lib 的精确公开 import。", mutationAnnotations, async context => {
    const result = await store.getState().viteConfigActions.importsEnsure(context.req.valid("json"));
    return result.status === 400 ? context.json(result.body, 400) : context.json(result.body);
  })
  .tool.register("post", "/project/read", projectReadValidator, "校验一个具体 Hono Vite 项目，并返回项目约定、公开 vite-config-lib import 与黑盒 README 资源。", annotations, async context => {
    const result = await store.getState().viteConfigActions.projectRead(context.req.valid("json"));
    return result.status === 400 ? context.json(result.body, 400) : context.json(result.body);
  })
  .tool.register("post", "/honoReact2", honoReact2Validator, "生成 vite-config-lib honoReact2 的精确 import 与 Hono/React Vite 配置片段。", annotations, context => context.json(store.getState().viteConfigActions.honoReact2(context.req.valid("json"))))
  .tool.register("post", "/honoServer", honoServerValidator, "生成 vite-config-lib honoServer 的精确 import 与服务启动表达式。", annotations, context => context.json(store.getState().viteConfigActions.honoServer(context.req.valid("json"))))
  .tool.register("post", "/honoUrl", honoUrlValidator, "生成 vite-config-lib honoUrl 的精确 import 与 renderer URL 表达式。", annotations, context => context.json(store.getState().viteConfigActions.honoUrl(context.req.valid("json"))));
