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
  "监督异常汇报：parent任务遗漏、未完成停止、Git 检查点缺失、GitHub 发布缺失或多 AI 写入冲突时调用，同步提醒parent",
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
  "上线或者下线汇报",
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
);

export default watcher;
