import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import workspaceAiContact from "mcp-server/mcp/ai-call-ai/WORKSPACE_AI_CONTACT.ts";
import Register from "mcp-server/public.ts";
import store from "../store.ts";
import { validator } from "./store.ts";
import pkg from "../../package.json"
const initializedWorkspacePaths = new Set<string>();

const contactSend = async (id: number) => {
  const todotree = store.getState().todotree;
  const path: (typeof todotree.nodesById)[number][] = [];
  const visited = new Set<number>();
  let node = todotree.nodesById[id];
  if (!node) throw new Error(`TodoTree node does not exist: ${String(id)}`);
  while (node) {
    if (visited.has(node.id)) {
      throw new Error(`TodoTree contains a parent cycle at: ${String(node.id)}`);
    }
    visited.add(node.id);
    path.unshift(node);
    if (node.id_parent === null) break;
    const parent = todotree.nodesById[node.id_parent];
    if (!parent) throw new Error(`TodoTree parent does not exist: ${String(node.id_parent)}`);
    node = parent;
  }
  const workspacePath = path[0]?.title;
  if (!workspacePath) throw new Error(`TodoTree root does not exist: ${String(id)}`);
  const contact = await workspaceAiContact.card(workspacePath);
  const remoteDebuggingPort = Number(/remoteDebuggingPort (\d+)/.exec(contact)?.[1]);
  if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort < 1) {
    throw new Error("The VS Code contact did not provide a debugging port.");
  }
  const currentNode = path.at(-1);
  if (!currentNode) throw new Error(`TodoTree node does not exist: ${String(id)}`);
  const initialized = initializedWorkspacePaths.has(workspacePath);
  const treeLines: string[] = [];
  if (!initialized) {
    const lineAppend = (nodeId: number, depth: number) => {
      const current = todotree.nodesById[nodeId];
      if (!current) throw new Error(`TodoTree node does not exist: ${String(nodeId)}`);
      treeLines.push(`${"  ".repeat(depth)}- ${String(current.id)}: ${current.title}`);
      Object.values(todotree.nodesById)
        .filter(child => child.id_parent === nodeId)
        .forEach(child => lineAppend(child.id, depth + 1));
    };
    lineAppend(path[0]!.id, 0);
  }
  const result = await workspaceAiContact.input({
    workspacePath,
    remoteDebuggingPort,
    message: [
      "【TodoTree 对话】",
      `当前节点 ID：${String(id)}`,
      ...(initialized ? [] : ["当前工作区完整任务树：", ...treeLines, ""]),
      "",
      `方先生：${currentNode.title}`,
      "",
      "回复时调用 todotree.add.POST，把答复作为当前节点的子节点写入 TodoTree；",
      "写入答复后调用 todotree.set.POST，把当前提问节点状态改为 5（已反馈）。",
    ].join("\n"),
  });
  initializedWorkspacePaths.add(workspacePath);
  await store.getState().todotreeActions.set({ id, status: 4 });
  return result;
};

export default new Register({ namespace: pkg.name })
  .register(
    "/add",
    new Hono().post(
      "/",
      zValidator("json", validator.add),
      async context => {
        try {
          const id = await store.getState().todotreeActions.add(context.req.valid("json"));
          const node = store.getState().todotree.nodesById[id];
          const fromMcp = typeof context.env === "object"
            && context.env !== null
            && "mcpServer" in context.env;
          const result = fromMcp || node?.id_parent === null
            ? undefined
            : await contactSend(id);
          return context.json({
            id,
            result,
          }, 200);
        } catch (error) {
          throw new HTTPException(502, {
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
        }
      },
    ),
    validator.add,
    "创建根任务或指定父任务下的子任务；页面调用时同时把新节点发送给对应工作区 Codex。",
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
          const node = store.getState().todotree.nodesById[options.id];
          const fromMcp = typeof context.env === "object"
            && context.env !== null
            && "mcpServer" in context.env;
          const result = !fromMcp
            && options.title !== undefined
            && node?.id_parent !== null
            ? await contactSend(options.id)
            : undefined;
          return context.json({
            id: options.id,
            result,
          }, 200);
        } catch (error) {
          throw new HTTPException(502, {
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });
        }
      },
    ),
    validator.set,
    "按任务 ID 修改一个标题、状态或执行者字段；页面修改标题时同时发送给对应工作区 Codex。",
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
