import { zValidator } from "@hono/zod-validator";
import mcpserver from "mcpserver";
import store from "../store";
import { conventionValidator } from "./store";

const convention = mcpserver.RegisterSlice({
  sliceName: "vite_config",
  description: "使用 vite-config-lib 运行 Hono 与一个或多个 React 项目",
}).tool.register(
    "post",
    "/honoReact2/read",
    conventionValidator,
    "取得 vite-config-lib 的完整接入步骤：安装依赖、配置 honoReact2，并在运行时配套使用 honoServer 与 honoUrl。",
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    zValidator("json", conventionValidator),
    async context => context.json(
      await store.getState().conventionActions.honoReact2.read(context.req.valid("json")),
    ),
).tool.register(
    "post",
    "/honoServer/read",
    conventionValidator,
    "取得 vite-config-lib/hono 的 honoServer 运行时黑盒用法。",
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    zValidator("json", conventionValidator),
    async context => context.json(
      await store.getState().conventionActions.honoServer.read(context.req.valid("json")),
    ),
).tool.register(
    "post",
    "/honoUrl/read",
    conventionValidator,
    "取得 vite-config-lib/hono 的 honoUrl 运行时黑盒用法。",
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    zValidator("json", conventionValidator),
    async context => context.json(
      await store.getState().conventionActions.honoUrl.read(context.req.valid("json")),
    ),
);

export default convention;
