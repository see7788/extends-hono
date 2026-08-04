import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import Register from "mcp-server/public.ts";
import store, { validator } from "./store.ts";

const streams = new Set<SSEStreamingApi>();
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
const projectTreeContract = `初始化项目交流并读取当前完整项目书。AI 只提交自己当前的绝对工作路径；服务端只把它解析到最近的已登记祖先项目，不依据 package.json、pnpm workspace 或其他语言文件猜测项目，也不公开内部允许根与其他项目。项目登记路径只生产一个 template=project 节点，严禁把路径中的盘符或目录分别建成节点。任务、问题、决策、数据、切片、生产者、消费者、蓝图、源码、验证与结果，全部是同一棵项目 tree 的节点。AI 进入已有或空项目后的第一项工作必须调用 conversation.init；未登记路径必须停止，不能自行登记或改认其他目录。

源码蓝图初始刚好三层：第一层 template=project，是完整项目路径；第二层 template=file，是从项目根开始的完整相对文件路径，文件即使经过多层目录也只生产这一行，严禁把中间目录建成节点；第三层 template=typescript，只列该文件真实公开成员，使用可成立的标准 TypeScript 类型或签名美化表达。成员下一行用 // 先写具体用途；该成员实际消费其他生产者时，继续写“调用 相对文件路径.成员()”，只记录直接调用，不越级展开。实现库时，非成品消费者入口但因库内实现必须导出的成员统一在签名前标记 [内]；私有成员、占位成员和无真实用途的导出不得进入项目书。

三层只定义初始源码蓝图，不限制整棵项目 tree 的深度。项目书成立后，每次交流以具体 typescript 成员节点为锚点，问题、目标、决策、实现、验证和结果作为其后代继续任意深度生长；conversation.init 必须传入该 memberId。空项目首次建立蓝图时尚无成员，可以省略 memberId，把首次交流临时挂到 project 节点。

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

错误：把 project、public、feature 等路径片段逐层建立为目录节点，再把 index.ts 或 web.ts 放到目录节点下面；只写签名却省略用途与直接消费链；把私有成员或无消费者的导出写进项目书。`;

export default new Register({
  namespace: "todo-mcp-node",
  description: "供人类与 AI 共同维护具体项目 tree；Hono 登记项目，AI 用 conversation.init 解析当前工作路径并建立交流节点。",
})
  .register(
    "/node/add",
    new Hono().post(
      "/",
      zValidator("json", validator.add),
      async context => {
        const options = context.req.valid("json");
        const nodeValue = store.add(options);
        await eventSend({ event: "add", data: nodeValue });
        return context.json(nodeValue, 200);
      },
    ),
    validator.add,
    "人类与 AI 共用：新增正式节点。AI 必须先调用 conversation.init，并遵守 template 生产关系；project→file→typescript 是初始三层源码蓝图。",
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
        const ids = store.del(id);
        const result = { ids };
        await eventSend({ event: "del", data: ids });
        return context.json(result, 200);
      },
    ),
    validator.del,
    "人类与 AI 共用：删除指定节点及其全部子节点，并返回被删除的节点 ID。AI 只能删除当前已解析项目内部节点。",
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
        const nodeValue = store.set(options);
        await eventSend({ event: "set", data: nodeValue });
        return context.json(nodeValue, 200);
      },
    ),
    validator.set,
    "人类与 AI 共用：修改指定节点并返回修改后的正式节点数据。AI 只能修改当前已解析项目内部节点。",
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  )
  .mcpAdd(
    "/conversation/init",
    new Hono().post(
      "/",
      zValidator("json", validator.conversationInit),
      async context => {
        const result = store.conversationInit(context.req.valid("json"));
        await eventSend({ event: "tree", data: store.tree() });
        return context.json(result, 200);
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
    "/project/resolve",
    new Hono().post(
      "/",
      zValidator("json", validator.projectResolve),
      context => context.json(store.projectResolve(context.req.valid("json").workspacePath), 200),
    ),
    validator.projectResolve,
    "把当前绝对工作路径解析到最近的已登记祖先项目并返回完整项目书；不创建项目，也不返回其他项目。",
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
      context => context.json(store.projectTree(context.req.valid("json").workspacePath), 200),
    ),
    validator.projectResolve,
    "读取当前项目完整项目书，不创建交流节点，也不返回其他项目。",
    {
      readOnlyHint: true,
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
        const project = store.projectRegister(context.req.valid("json").projectPath);
        await eventSend({ event: "tree", data: store.tree() });
        return context.json(project, 200);
      },
    ),
  )
  .honoAdd(
    "/project/list",
    new Hono().get("/", context => context.json(store.projectList(), 200)),
  )
  .mcpAdd(
    "/node/get",
    new Hono().post(
      "/",
      zValidator("json", validator.projectNodeRead),
      context => context.json(store.projectNodeGet(context.req.valid("json")), 200),
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
      context => context.json(store.projectNodeChildren(context.req.valid("json")), 200),
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
      context => context.json(store.projectNodeContext(context.req.valid("json")), 200),
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
      context => context.json(store.projectNodeSearch(context.req.valid("json")), 200),
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
      context => context.json(store.tree(), 200),
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
          data: JSON.stringify(store.tree()),
        });
        await closed;
      } finally {
        streams.delete(stream);
      }
    })),
  );
