import { zValidator } from "@hono/zod-validator";
import mcpserver from "mcpserver";
import { z } from "zod";

const conventionValidator = z.object({
  projectPaths: z.array(z.string().trim().min(1)).min(1)
    .describe("本次需要接入或检查配置库的完整项目绝对路径集合。"),
  task: z.enum(["create", "modify", "review"])
    .describe("create 创建接入；modify 修改现有接入；review 只读检查。"),
});

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export default mcpserver.RegisterSlice({
  sliceName: "convention",
  description: "使用 vite-config-lib 运行 Hono 与一个或多个 React 项目",
}).tool.register(
  "post",
  "/honoReact2/read",
  conventionValidator,
  "取得 vite-config-lib 的完整接入步骤：安装依赖、配置 honoReact2，并在运行时配套使用 honoServer 与 honoUrl。",
  annotations,
  zValidator("json", conventionValidator),
  context => {
    const { projectPaths, task } = context.req.valid("json");
    return context.json({
      instruction:
        `任务边界: ${task}。\n` +
        `只处理 plugin2/honoReact2 约定。\n` +
        `要求：\n` +
        `1. 确认安装 vite-config-lib。\n` +
        `2. 在 Vite 配置中从 vite-config-lib/plugin2 导入 honoReact2。\n` +
        `3. 配置 Hono 入口、port、renderer（/index.tsx 相对入口）和 hono.external。\n` +
        `4. 给出可验证清单；仅处理本任务范围内配置，不扩展到其他文件。\n` +
        `范围：${projectPaths.join(", ")}`,
      pairedTools: ["convention.honoServer.read.POST", "convention.honoUrl.read.POST"],
    });
  },
).tool.register(
  "post",
  "/honoServer/read",
  conventionValidator,
  "取得 vite-config-lib/hono 的 honoServer 运行时黑盒用法。",
  annotations,
  zValidator("json", conventionValidator),
  context => {
    const { projectPaths, task } = context.req.valid("json");
    return context.json({
      instruction:
        `任务边界: ${task}。\n` +
        `只读取 vite-config-lib/hono 中 honoServer 约定。\n` +
        `要求：从 vite-config-lib/hono 导入 honoServer，并以现有 Hono 实例调用；监听与静态回退由黑盒承担。\n` +
        `范围：${projectPaths.join(", ")}。\n` +
        `仅处理现有实例接入，不手工处理监听或 dist 回退逻辑。`,
      pairedTools: ["convention.honoReact2.read.POST"],
    });
  },
).tool.register(
  "post",
  "/honoUrl/read",
  conventionValidator,
  "取得 vite-config-lib/hono 的 honoUrl 运行时黑盒用法。",
  annotations,
  zValidator("json", conventionValidator),
  context => {
    const { projectPaths, task } = context.req.valid("json");
    return context.json({
      instruction:
        `任务边界: ${task}。\n` +
        `只读取 vite-config-lib/hono 中 honoUrl 约定。\n` +
        `要求：从 vite-config-lib/hono 导入 honoUrl，以 renderer 的 package.json#name 调用；不手工拼装页面 URL。\n` +
        `范围：${projectPaths.join(", ")}。\n` +
        `仅处理约定映射与调用边界，不新增其他语义。`,
      pairedTools: ["convention.honoReact2.read.POST"],
    });
  },
);
