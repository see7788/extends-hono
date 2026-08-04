import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import Register from "mcp-server/public.ts";
import store from "../store.ts";
import { validator } from "./store.ts";
import pkg from "../../package.json"

export default new Register({ namespace: pkg.name })
  .register(
    "/add",
    new Hono().post(
      "/",
      zValidator("json", validator.add),
      async context => {
        try {
          const id = await store.getState().todotreeActions.add(context.req.valid("json"));
          return context.json({ id }, 200);
        } catch (error) {
          throw new HTTPException(502, {
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
        }
      },
    ),
    validator.add,
    "在固定根节点或指定父任务下创建节点。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/set",
    new Hono().post(
      "/",
      zValidator("json", validator.set),
      async context => {
        try {
          const options = context.req.valid("json");
          await store.getState().todotreeActions.set(options);
          return context.json({ id: options.id }, 200);
        } catch (error) {
          throw new HTTPException(502, {
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
        }
      },
    ),
    validator.set,
    "按任务 ID 修改一个标题、状态或执行者字段。",
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
      zValidator("query", validator.treeQuery),
      context => context.json(store.getState().todotree, 200),
    ),
    validator.treeQuery,
    "读取当前完整任务树、状态标签和执行者标签。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .honoAdd("/events",
    new Hono().get(context => streamSSE(context, async stream => {
      let active = true;
      let writes = Promise.resolve();
      let finish = () => { };
      const closed = new Promise<void>(resolve => {
        finish = resolve;
      });
      const unsubscribe = store.subscribe((state, previousState) => {
        for (const [id, node] of Object.entries(state.todotree.nodesById)) {
          if (!active) continue;
          const previousNode = previousState.todotree.nodesById[Number(id)];
          if (!previousNode) {
            writes = writes.then(() => stream.writeSSE({
              event: "add",
              data: JSON.stringify({
                title: node.title,
                id_parent: node.id_parent,
                status: node.status,
                agent: node.agent,
              }),
            }));
            continue;
          }
          if (node.title !== previousNode.title) {
            writes = writes.then(() => stream.writeSSE({
              event: "set",
              data: JSON.stringify({ id: node.id, title: node.title }),
            }));
          }
          if (node.status !== previousNode.status) {
            writes = writes.then(() => stream.writeSSE({
              event: "set",
              data: JSON.stringify({ id: node.id, status: node.status }),
            }));
          }
          if (node.agent !== previousNode.agent) {
            writes = writes.then(() => stream.writeSSE({
              event: "set",
              data: JSON.stringify({ id: node.id, agent: node.agent }),
            }));
          }
        }
      });
      writes = writes.then(() => stream.writeSSE({
        event: "tree",
        data: JSON.stringify(store.getState().todotree),
      }));
      stream.onAbort(() => {
        active = false;
        unsubscribe();
        finish();
      });
      await closed;
      await writes;
    }))
  );
