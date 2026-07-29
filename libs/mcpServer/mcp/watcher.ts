import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";

const alertSchema = z.object({
  kind: z.enum([
    "TaskOmitted",
    "TaskIncompleteStop",
    "GitCheckpointMissing",
    "GitPublishMissing",
    "ConcurrentWriteConflict",
  ]),
  message: z.string().min(1),
});

const watcher = new Register().register(
  "/work",
  new Hono().post("/", async context => {
    const alert = alertSchema.parse(await context.req.json());
    console.log(`[watcher:${alert.kind}] ${alert.message}`);
    return context.body(null, 204);
  }),
  alertSchema,
  "parent 发现任务遗漏、未完成停止、Git 检查点或发布缺失、多 AI 写入冲突时调用；必填 kind 和非空 message；成功记录一条 watcher 警报并返回 HTTP 204，不修改仓库或外部系统；kind 无效或 message 为空时失败，按 schema 修正输入后重试。",
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
).register(
   "/holle",
  new Hono().post("/", async context => {
    const alert = alertSchema.parse(await context.req.json());
    console.log(`[watcher:${alert.kind}] ${alert.message}`);
    return context.body(null, 204);
  }),
  alertSchema,
  "需要通过 holle 入口记录 watcher 警报时调用；必填 kind 和非空 message；成功记录警报并返回 HTTP 204，不修改仓库或外部系统；kind 无效或 message 为空时失败，按 schema 修正输入后重试。",
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
);

export default watcher;
