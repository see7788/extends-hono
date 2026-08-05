import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { z } from "zod";
import Register, { type McpServerBindings } from "mcp-server-lib/public.ts";
import mcpStore from "mcp-server-lib/store/index.ts";
import { templateOptions } from "./contract.ts";
import store, { validator } from "./store.ts";

const agentMeInput = z.object({});
const { todotreeActions } = store;
type TodoTreeEnv = { Bindings: Partial<McpServerBindings> };
const conversationRuntimeRead = (context: Context<TodoTreeEnv>) => {
  const mcpServer = context.env.mcpServer;
  if (!mcpServer) return undefined;
  const sessionId = mcpServer.sessionId;
  if (!sessionId) {
    throw new HTTPException(409, {
      message: "当前 MCP transport 未提供 sessionId，不能验证 TodoTree 会话。",
    });
  }
  try {
    return mcpServer.agentRuntimeActions.sessionGet(sessionId);
  } catch (cause) {
    throw new HTTPException(409, {
      cause,
      message: "当前 MCP 会话尚未调用 conversation.init。",
    });
  }
};
const conversationAssert = (context: Context<TodoTreeEnv>) => {
  if (!conversationRuntimeRead(context) && context.env.mcpServer) {
    throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
  }
};
const streams = new Set<SSEStreamingApi>();
const eventSend = async ({
  data,
  event,
}: {
  data: unknown;
  event: "add" | "ai" | "attention" | "del" | "node" | "set" | "tree";
}) => {
  for (const stream of [...streams]) {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch {
      streams.delete(stream);
    }
  }
};
const agentRuntimeUnsubscribe = mcpStore.subscribe((state, previousState) => {
  if (state.agentRuntime === previousState.agentRuntime) return;
  void eventSend({ event: "ai", data: state.agentRuntimeActions.list() });
});
const hot = (import.meta as ImportMeta & {
  hot?: { dispose(callback: () => void): void };
}).hot;
if (hot) hot.dispose(agentRuntimeUnsubscribe);
const projectTreeContract = `初始化项目交流并读取当前完整项目书。AI 提交当前项目的绝对路径用于项目解析，并把本次会话 environment_context 中的 cwd 原样作为 windowPath；服务端分别验证项目和真实 VS Code 窗口目录，不从任务项目路径、package.json、pnpm workspace 或进程标题推导窗口路径，也不公开内部允许根或其他项目。projectPathExists 为 false 表示登记的历史项目路径已经不存在或不再是目录，必须使用 project.migrate 修正，不能把失效路径当作当前项目根。项目登记路径只生产一个 template=${templateOptions[0].value} 节点，严禁把路径中的盘符或目录分别建成节点。任务、问题、决策、数据、切片、生产者、消费者、蓝图、源码、验证与结果，全部是同一棵项目 tree 的节点。AI 进入已有或空项目后的第一项工作必须调用 conversation.init；未登记路径必须停止，不能自行登记或改认其他目录。

源码蓝图初始刚好三层：第一层 template=${templateOptions[0].value}，是完整项目路径；第二层 template=${templateOptions[1].value}，是从项目根开始的完整相对文件路径，文件即使经过多层目录也只生产这一行，严禁把中间目录建成节点；第三层 template=${templateOptions[2].value}，只列该文件真实公开成员，使用可成立的标准 TypeScript 类型或签名美化表达。成员下一行用 // 先写具体用途；该成员实际消费其他生产者时，继续写“调用 相对文件路径.成员()”，只记录直接调用，不越级展开。实现库时，非成品消费者入口但因库内实现必须导出的成员统一在签名前标记 [内]；私有成员、占位成员和无真实用途的导出不得进入项目书。

三层只定义初始源码蓝图，不限制整棵项目 tree 的深度。conversation.init 只验证当前 AI、真实窗口、工作路径并绑定项目，不创建任务、不接收 memberId、targetId、title，也不修改任何节点。完成初始化后，使用 task.open 或 task.openMany 在 project、file 或 typescript 节点下创建 Markdown 任务；任务的 start、complete、block、cancel 与 decision 通过对应 task 接口完成。

正确：
project/
├── public/index.ts
│   ├── type DataName<TData> = DataNameNode<NonNullable<TData>, []>
│   │   // 限定 TData 的安全数据路径。
│   └── type DataStore<TData extends object> = { data: TData }
│       // 定义由业务唯一生产、供协议切片消费的数据根。
└── feature/web.ts
    └── default: zustand.StateCreator<WebStore>
        // 生产 Web 端协议切片。

错误：把 project、public、feature 等路径片段逐层建立为目录节点，再把 index.ts 或 web.ts 放到目录节点下面；只写签名却省略用途与直接消费链；把私有成员或无消费者的导出写进项目书。

交流规则：status: 1 只表示任务下的待定事项；status: 2 表示任务待办；status: 4 表示任务工作中；status <= 6 表示未收口，status > 6 统一表示收口。任务必须通过 task.open/task.openMany 创建，源码蓝图节点不计入 attention。人类回答后，AI 立即把对应待定事项改为完成或取消。每次回复前调用 project.attention；第一行只写全部待定 ID，例如“待你决策：#12、#15”，没有待定时只写“无”。项目根 status 只表达项目生命周期，严禁因存在待定事项而修改项目根。`;

export default new Register({
  namespace: "todo-mcp-node",
  description: "供人类与 AI 共同维护具体项目 tree；Hono 登记项目，AI 用 conversation.init 验证会话并绑定项目。",
})
  .register(
    "/node/add",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.add),
      async context => {
        conversationAssert(context);
        const options = context.req.valid("json");
        if (context.env.mcpServer && options.template === "markdown") {
          throw new HTTPException(409, {
            message: "AI 任务必须使用 task.open；node.add 不生产任务节点。",
          });
        }
        if (context.env.mcpServer && options.status === 1) {
          throw new HTTPException(409, {
            message: "AI 待定事项必须使用 task.decision；node.add 不生产任务决策。",
          });
        }
        const nodeValue = todotreeActions.add(options);
        await eventSend({ event: "add", data: nodeValue });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(nodeValue, 200);
      },
    ),
    validator.add,
    "人类与 AI 共用：新增正式节点。AI 必须先调用 conversation.init；源码蓝图用 project→file→typescript，Markdown 任务必须用 task.open。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/node/batch",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.batch),
      async context => {
        conversationAssert(context);
        const options = context.req.valid("json");
        const taskFound = (nodes: typeof options.nodes): boolean => nodes.some(node => (
          node.template === "markdown" || node.status === 1 || taskFound(node.children ?? [])
        ));
        if (context.env.mcpServer && taskFound(options.nodes)) {
          throw new HTTPException(409, {
            message: "AI 任务与待定事项必须使用 task.openMany/task.decision；node.batch 不生产任务节点。",
          });
        }
        const nodes = todotreeActions.batch(options);
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        return context.json(nodes, 200);
      },
    ),
    validator.batch,
    "人类与 AI 共用：在一个 SQLite transaction 中递归新增源码蓝图节点；Markdown 任务必须用 task.openMany；任一节点失败时整批不写入。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/node/del",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.del),
      async context => {
        conversationAssert(context);
        const { id } = context.req.valid("json");
        const ids = todotreeActions.del(id);
        const result = { ids };
        await eventSend({ event: "del", data: ids });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(result, 200);
      },
    ),
    validator.del,
    "人类与 AI 共用：删除指定节点及其全部子节点，并返回被删除的节点 ID；MCP 调用必须先完成 conversation.init。",
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .register(
    "/node/move",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.move),
      async context => {
        conversationAssert(context);
        const nodeValue = todotreeActions.move(context.req.valid("json"));
        await eventSend({ event: "set", data: nodeValue });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(nodeValue, 200);
      },
    ),
    validator.move,
    "人类与 AI 共用：把非项目节点迁移到同一具体项目的新父节点，并维护层级、循环与完成状态不变量；MCP 调用必须先完成 conversation.init。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .register(
    "/node/set",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.set),
      async context => {
        conversationAssert(context);
        const options = context.req.valid("json");
        const nodeValue = todotreeActions.set(options);
        await eventSend({ event: "set", data: nodeValue });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(nodeValue, 200);
      },
    ),
    validator.set,
    "人类与 AI 共用：修改指定节点并返回修改后的正式节点数据。status <= 6 表示未收口，status > 6 表示收口；MCP 调用必须先完成 conversation.init。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/conversation/init",
    new Hono<{ Bindings: McpServerBindings }>().post(
      "/",
      zValidator("json", validator.conversationInit),
      async context => {
        const options = context.req.valid("json");
        const sessionId = context.env.mcpServer.sessionId;
        if (!sessionId) {
          throw new HTTPException(409, {
            message: "当前 MCP transport 未提供 sessionId，不能登记在线 AI。",
          });
        }
        const result = todotreeActions.conversationInit(options);
        const agent = context.env.mcpServer.agentRuntimeActions.projectBind({
          projectId: result.projectId,
          sessionId,
          windowPath: result.windowPath,
        });
        return context.json({ ...result, agent }, 200);
      },
    ),
    validator.conversationInit,
    projectTreeContract,
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/agent/me",
    new Hono<{ Bindings: McpServerBindings }>().post(
      "/",
      zValidator("json", agentMeInput),
      context => {
        const sessionId = context.env.mcpServer.sessionId;
        if (!sessionId) {
          throw new HTTPException(409, {
            message: "当前 MCP transport 未提供 sessionId。",
          });
        }
        return context.json(context.env.mcpServer.agentRuntimeActions.sessionGet(sessionId), 200);
      },
    ),
    agentMeInput,
    "读取当前 VS Code MCP 会话的在线 AI 编号、已验证的真实窗口路径和已绑定项目；必须先调用 conversation.init。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/open",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskOpen),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const task = todotreeActions.taskOpen({
          ...context.req.valid("json"),
          projectIds: runtime.projectIds,
        });
        await eventSend({ event: "add", data: task });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(task, 200);
      },
    ),
    validator.taskOpen,
    "在当前 AI 已绑定项目内创建一个 project、file 或 typescript 目标下的 Markdown 任务。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/open-many",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskOpenMany),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const options = context.req.valid("json");
        if (options.targets.some(target => !runtime.projectIds.includes(target.projectId))) {
          throw new HTTPException(409, { message: "task.openMany 的 projectId 不属于当前 AI 已绑定项目。" });
        }
        const tasks = todotreeActions.taskOpenMany(options);
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(tasks, 200);
      },
    ),
    validator.taskOpenMany,
    "在一个事务中向当前 AI 已绑定的多个具体项目登记任务；任一目标不合法时整批不写入。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/start",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskId),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const task = todotreeActions.taskStart({ ...context.req.valid("json"), projectIds: runtime.projectIds });
        await eventSend({ event: "set", data: task });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(task, 200);
      },
    ),
    validator.taskId,
    "把当前 AI 已绑定项目中的待办任务改为工作中。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/complete",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskComplete),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const task = todotreeActions.taskComplete({ ...context.req.valid("json"), projectIds: runtime.projectIds });
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(task, 200);
      },
    ),
    validator.taskComplete,
    "在任务后代全部收口后保存验收结果并完成任务。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/block",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskBlock),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const task = todotreeActions.taskBlock({ ...context.req.valid("json"), projectIds: runtime.projectIds });
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(task, 200);
      },
    ),
    validator.taskBlock,
    "保存阻塞原因与证据，并把任务收口为阻塞。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/cancel",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskCancel),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const task = todotreeActions.taskCancel({ ...context.req.valid("json"), projectIds: runtime.projectIds });
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(task, 200);
      },
    ),
    validator.taskCancel,
    "保存取消原因，并把任务收口为取消。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/task/decision",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.taskDecision),
      async context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const decision = todotreeActions.taskDecision({ ...context.req.valid("json"), projectIds: runtime.projectIds });
        await eventSend({ event: "add", data: decision });
        await eventSend({ event: "attention", data: todotreeActions.tree().projectAttentionById });
        return context.json(decision, 200);
      },
    ),
    validator.taskDecision,
    "在真实任务下登记一项待定决策。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/project/attention",
    new Hono<TodoTreeEnv>().post(
      "/",
      zValidator("json", validator.projectAttention),
      context => {
        const runtime = conversationRuntimeRead(context);
        if (!runtime) throw new HTTPException(409, { message: "当前 MCP 会话尚未调用 conversation.init。" });
        const options = context.req.valid("json");
        if (options.projectIds.some(projectId => !runtime.projectIds.includes(projectId))) {
          throw new HTTPException(409, { message: "project.attention 的 projectIds 不属于当前 AI 已绑定项目。" });
        }
        return context.json(todotreeActions.projectAttention(options), 200);
      },
    ),
    validator.projectAttention,
    "按 projectIds 批量读取当前 AI 已绑定项目中真实任务派生的待定、阻塞、工作中和待办数量；源码蓝图节点不参与计数。AI 每次回复前调用本接口：任一 decisionIds 非空时第一行列出全部待定 ID，否则第一行只写“无”。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/project/maintenance",
    new Hono().post(
      "/",
      zValidator("json", validator.projectMaintenance),
      context => context.json(todotreeActions.projectMaintenance(), 200),
    ),
    validator.projectMaintenance,
    "读取所有登记但路径已失效的具体项目；返回 projectId、projectPath 和 reason，AI 必须使用 project.migrate 修复后再维护项目。没有失效项目时返回空数组。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/project/resolve",
    new Hono().post(
      "/",
      zValidator("json", validator.projectResolve),
      context => context.json(todotreeActions.projectResolve(context.req.valid("json").workspacePath), 200),
    ),
    validator.projectResolve,
    "把当前绝对工作路径解析到最近的已登记祖先项目并返回完整项目书；projectPathExists 为 false 时说明历史路径已失效，应迁移后再使用；不创建项目，也不返回其他项目。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/project/tree",
    new Hono().post(
      "/",
      zValidator("json", validator.projectResolve),
      context => context.json(todotreeActions.projectTree(context.req.valid("json").workspacePath), 200),
    ),
    validator.projectResolve,
    "读取当前项目完整项目书；projectPathExists 为 false 时说明登记路径已失效，应使用 project.migrate；不创建交流节点，也不返回其他项目。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .register(
    "/project/migrate",
    new Hono().post(
      "/",
      zValidator("json", validator.projectMigrate),
      async context => {
        const project = todotreeActions.projectMigrate(context.req.valid("json"));
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        return context.json(project, 200);
      },
    ),
    validator.projectMigrate,
    "人类与 AI 共用：把一个已登记项目迁移到新的真实绝对路径；保留项目 ID 与完整子树，并拒绝 pnpm 容器或已被其他项目占用的目标路径。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .honoAdd(
    "/project/register",
    new Hono().post(
      "/",
      zValidator("json", validator.projectRegister),
      async context => {
        const project = todotreeActions.projectRegister(context.req.valid("json").projectPath);
        await eventSend({ event: "tree", data: todotreeActions.tree() });
        return context.json(project, 200);
      },
    ),
  )
  .honoAdd(
    "/project/list",
    new Hono().get("/", context => context.json(todotreeActions.projectList(), 200)),
  )
  .mcpAdd(
    "/node/get",
    new Hono().post(
      "/",
      zValidator("json", validator.projectNodeRead),
      context => context.json(todotreeActions.projectNodeGet(context.req.valid("json")), 200),
    ),
    validator.projectNodeRead,
    "按节点 ID 读取当前项目内一个正式节点；节点不属于当前项目时拒绝读取。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/node/children",
    new Hono().post(
      "/",
      zValidator("json", validator.projectNodeRead),
      context => context.json(todotreeActions.projectNodeChildren(context.req.valid("json")), 200),
    ),
    validator.projectNodeRead,
    "读取当前项目内指定节点的直接子节点，不递归读取后代。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/node/context",
    new Hono().post(
      "/",
      zValidator("json", validator.projectNodeRead),
      context => context.json(todotreeActions.projectNodeContext(context.req.valid("json")), 200),
    ),
    validator.projectNodeRead,
    "读取当前项目内指定节点的精确上下文：返回从项目根到该节点的完整祖先链，以及该节点的全部子节点；节点不属于当前项目时拒绝读取。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/node/search",
    new Hono().post(
      "/",
      zValidator("json", validator.nodeSearch),
      context => context.json(todotreeActions.projectNodeSearch(context.req.valid("json")), 200),
    ),
    validator.nodeSearch,
    "在当前项目内按 title、template、status、agent 任意组合查询节点；只返回命中的正式节点。",
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .honoAdd(
    "/tree",
    new Hono().get(
      "/",
      context => context.json(todotreeActions.tree(), 200),
    ),
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
          data: JSON.stringify(todotreeActions.tree()),
        });
        await stream.writeSSE({
          event: "ai",
          data: JSON.stringify(mcpStore.getState().agentRuntimeActions.list()),
        });
        await closed;
      } finally {
        streams.delete(stream);
      }
    })),
  );
