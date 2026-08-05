# mcp-server

`mcp-server` 把项目内 Hono/MCP 注册成品与来自 npm 的外部 MCP 统一交付到
`/todo-mcp`；本地命名空间常驻，npm 命名空间由 AI 按需开启并在最后一次调用完成
20 分钟后精确关闭。每个 VS Code MCP 连接拥有独立 session；在线 AI 编号、真实窗口路径
和项目关系只存在于当前 Node 进程内；AI 在 `conversation.init` 中直接交付本次会话环境
提供的 VS Code 窗口 cwd，服务端验证真实目录后登记，不从任务项目路径推导，也不持久化。

```ts
import { Hono } from "hono";
import Mcp from "mcp-server/index.ts";
import tpl from "honoapp/src/tpl/index";
import todocli from "mcpcreate-lib/index";
import todotree from "./todotree/index.ts";

const mcp = new Mcp()
  .register(tpl)
  .register(todocli)
  .register(todotree);

export default new Hono().route("/", mcp.hono);
```

## 源码结构

```text
libs/mcpServer/
├── index.ts
│   └── default class Mcp<CurrentSchema extends Schema = {}>
│       ├── constructor()                                  // 装配注册成品及兼容新旧协议的 /todo-mcp
│       ├── register<Namespace extends string, FragmentSchema extends Schema>(
│       │     register: Register<Namespace, FragmentSchema>,
│       │   ): Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>
│       │                                                  // 交付一个始终运行的项目内命名空间
│       ├── registerPkg<Namespace extends string, FragmentSchema extends Schema>(
│       │     register: RegisterFromNpm<Namespace, FragmentSchema>,
│       │   ): Promise<Mcp<NextSchema<CurrentSchema, Namespace, FragmentSchema>>>
│       │                                                  // 只登记一个按需运行的 npm 命名空间
│       └── readonly hono: HonoBase<BlankEnv, CurrentSchema, "/", "/">
│                                                          // 交付全部 Hono 路由和唯一 MCP 入口
├── public.ts
│   ├── type AgentRuntime = {
│   │     id: number;
│   │     projectIds: number[];
│   │     windowPath: string;
│   │   }                                                  // 交付一个在线 AI 会话的运行时数据
│   ├── type McpServerBindings                             // [内] 向 MCP Hono action 交付 session 与运行时动作
│   ├── type RegistrationData<Namespace extends string, CurrentSchema extends Schema> = {
│   │     namespace: Namespace;
│   │     description: string;
│   │     hono: HonoBase;
│   │     tools: readonly ToolRegistration[];
│   │   }                                                  // [内] 注册成品向母库交付的唯一数据
│   └── default class Register<Namespace extends string, CurrentSchema extends Schema = {}>
│       ├── constructor(options: { namespace: Namespace; description?: string })
│       │                                                  // 收集本地命名空间及其产品说明
│       ├── register(...definition: Definition): Register  // 同时收集 Hono 与 MCP 动作
│       ├── honoAdd(path: `/${string}`, hono: HonoBase): Register
│       │                                                  // 只收集 Hono 动作
│       ├── mcpAdd(...definition: Definition): Register    // 只收集 MCP 动作
│       ├── readonly hono: RegistrationData["hono"]       // 不装配母库时直接消费 Hono
│       └── deliver(): RegistrationData                    // 验证并唯一交付注册成品
├── mcp/
│   ├── ai-runtime/
│   │   └── store.ts
│   │       └── default: StateCreator<Store, ..., AgentRuntimeSlice>
│   │                                                      // 生产在线 AI 会话切片；不持久化
│   ├── overview.ts
│   │   ├── type NamespaceSummary = {
│   │   │     namespace: string;
│   │   │     description: string;
│   │   │     kind: "local" | "npm";
│   │   │     status: "closed" | "opening" | "running" | "closing" | "error";
│   │   │   }                                              // AI 第一层读取的轻量产品目录
│   │   ├── type NamespaceInfo = NamespaceSummary & {
│   │   │     toolCount: number | null;
│   │   │     tools: Tool[];
│   │   │     nextOffset: number | null;
│   │   │   }                                              // AI 第二层分页读取的具体产品契约
│   │   └── class Overview                                 // [内] 生产 mcp.list/listInfo/open/close
│   ├── ai-call-ai/                                        // 生产工作区之间的 AI 联系能力
│   ├── watcher.ts                                         // 生产 watcher 定义、报告和生命周期动作
│   └── workcopy/                                          // 生产 SSD 工作副本数据与业务动作
├── mcpFromNpm/
│   ├── public.ts
│   │   ├── type PackageStatus = "closed" | "opening" | "running" | "closing" | "error"
│   │   └── default class RegisterFromNpm<
│   │         Namespace extends string,
│   │         AddedSchema extends Schema = {},
│   │       >
│   │       ├── readonly namespace: Namespace              // 交付稳定产品命名空间
│   │       ├── readonly description: string               // 交付未启动时也可读取的产品说明
│   │       ├── constructor(options: { namespace: Namespace; description: string })
│   │       ├── readonly status: PackageStatus             // 交付当前真实生命周期状态
│   │       ├── registerPkg(options: PackageDefinition): this
│   │       │                                              // 收集唯一 Transport 生产方法和使用说明
│   │       ├── mcpDel(toolName: string): this             // 删除指定来源工具
│   │       ├── mcpReplace(replacement: Replacement): this // 替换指定来源工具契约
│   │       ├── register(definition: Definition): RegisterFromNpm
│   │       │                                              // 增加同时用于 Hono 与 MCP 的项目内动作
│   │       ├── honoAdd(path: `/${string}`, hono: HonoBase): RegisterFromNpm
│   │       │                                              // 增加只用于 Hono 的项目内动作
│   │       ├── mcpAdd(definition: Definition): RegisterFromNpm
│   │       │                                              // 增加只用于 MCP 的项目内动作
│   │       ├── readonly hono: Promise<RegistrationData["hono"]>
│   │       ├── deliver(): Promise<RegistrationData>       // 真实连接并交付 Client、Transport 和工具
│   │       ├── healthAudit(): Promise<boolean>            // [内] 审计失效运行时并调用 close()
│   │       └── close(): Promise<void>                     // [内] 精确关闭 Client 与 Transport
│   ├── browser.ts                                         // 可观察 Chrome 产品
│   ├── codegraph.ts                                       // 源码索引与调用关系产品
│   ├── docs.ts                                            // 外部技术文档产品
│   ├── io.ts                                              // 受限文件系统产品
│   └── workspace.ts                                       // 桌面工作区产品
└── store/
    ├── index.ts                                           // 唯一 Zustand 主仓库
    └── type.ts                                            // 组合在线 AI、MCP 错误与 workcopy 切片类型
```

## 核心使用

AI 固定通过四个本地控制动作管理 npm 成品 MCP：

```text
mcp.list.GET
→ 只读取全部命名空间的用途、类型和运行状态

mcp.open.POST({ namespace: "browser" })
→ 关闭时真实启动；启动中复用同一个 Promise；运行中只续期

mcp.listInfo.GET({ namespace: "browser", offset: 0, limit: 20 })
→ 分页读取该命名空间的具体工具契约，不会隐式启动

mcp.close.POST({ namespace: "browser" })
→ 无执行中调用时立即从母库移除工具并关闭 Client 与 Transport
```

每个 npm 命名空间最多只有一个共享运行实例。工具开始调用时取消闲置倒计时，调用完成后
重新计时 20 分钟；多个 VS Code/AI 的任何一次访问都会共同续期。执行中的工具不会被自动
或显式关闭。本地 `Register` 没有独立 Client、Transport 或子进程，始终运行且拒绝关闭。

自有命名空间变得耗资源后，可以保持 namespace、工具名和工具契约不变，把生产方式从
`Register` 迁移为 `RegisterFromNpm`；MCP 工具可以平滑过渡，Hono 路由仍需由母库或独立
HTTP 服务交付。
