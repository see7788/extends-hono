import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import Register from "mcp-server/public.ts";
import { z } from "zod";
import store from "../store.ts";
import { validator } from "./store.ts";

const streams = new Set<SSEStreamingApi>();
const treeQuery = z.object({});
const eventSend = async ({
  data,
  event,
}: {
  data: unknown;
  event: "add" | "del" | "set" | "tree";
}) => {
  for (const stream of [...streams]) {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch {
      streams.delete(stream);
    }
  }
};

export default new Register({
  namespace: "todo-mcp-node",
  description: "供人类与 AI 共同维护项目任务树。",
})
  .register(
    "/node/add",
    new Hono().post(
      "/",
      zValidator("json", validator.add),
      async context => {
        const options = context.req.valid("json");
        const nodeValue = store.getState().todotreeActions.add(options);
        await eventSend({ event: "add", data: options });
        return context.json(nodeValue, 200);
      },
    ),
    validator.add,
    "给指定父节点新增一个节点，并返回正式节点数据。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/node/del",
    new Hono().post(
      "/",
      zValidator("json", validator.del),
      async context => {
        const { id } = context.req.valid("json");
        const ids = store.getState().todotreeActions.del(id);
        const result = { ids };
        await eventSend({ event: "del", data: id });
        return context.json(result, 200);
      },
    ),
    validator.del,
    "删除指定节点及其全部子节点，并返回被删除的节点 ID。",
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/node/set",
    new Hono().post(
      "/",
      zValidator("json", validator.set),
      async context => {
        const options = context.req.valid("json");
        const nodeValue = store.getState().todotreeActions.set(options);
        await eventSend({ event: "set", data: options });
        return context.json(nodeValue, 200);
      },
    ),
    validator.set,
    "修改指定节点并返回修改后的正式节点数据。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .register(
    "/tree",
    new Hono().get(
      "/",
      zValidator("query", treeQuery),
      context => context.json(store.getState().todotree, 200),
    ),
    treeQuery,
    "读取当前完整任务树与最大节点 ID。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .honoAdd(
    "/events",
    new Hono().get("/", context => streamSSE(context, async stream => {
      streams.add(stream);
      const closed = new Promise<void>(resolve => {
        stream.onAbort(resolve);
      });
      try {
        await stream.writeSSE({
          event: "tree",
          data: JSON.stringify(store.getState().todotree),
        });
        await closed;
      } finally {
        streams.delete(stream);
      }
    })),
  );
