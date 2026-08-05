# todo-mcp-node

`todo-mcp-node` 在一个 Hono 入口中交付 todo-mcp、TodoTree 页面、原 honoapp 模板能力和 create-todo-cli；运行 `pnpm --filter todo-mcp-node dev` 后打开 `http://127.0.0.1:3005/todotree/` 使用。

## 项目结构

```text
todo-mcp-node/
├── src/
│   ├── index.ts
│   ├── routers.ts
│   │   ├── type TodoMcpApi = typeof router
│   │   │   // 交付前端 hc 消费的完整 Hono API 类型。
│   │   └── default: Hono
│   │       // 组合 mcp-server、honoapp、mcpcreate-lib 与 todotree；调用 todotree/index.default。
│   └── todotree/
│       ├── contract.ts
│       │   ├── const statusOptions: readonly Option<Status>[]
│       │   │   // 生产 Hono、MCP 与页面共用的完整 1-9 状态映射。
│       │   ├── const statusOptionsVisible: readonly Option<Status>[]
│       │   │   // 生产未启用工作队时的页面状态入口。
│       │   ├── const templateOptions: readonly Option<Template>[]
│       │   │   // 生产 Hono、MCP 与页面共用的节点模板映射。
│       │   └── const contractValidator: { agent; status; template }
│       │       // 生产节点原始字段的唯一验证器。
│       ├── store.ts
│       │   ├── [内] const validator: { add; batch; conversationInit; del; move; nodeSearch;
│       │   │     projectAttention; projectMaintenance; projectMigrate; projectNodeRead;
│       │   │     projectRegister; projectResolve; set; taskBlock; taskCancel; taskComplete;
│       │   │     taskDecision; taskId; taskOpen; taskOpenMany }
│       │   │   // 生产 index.ts 注册 Hono 与 MCP 所需的输入契约；调用 contract.contractValidator。
│       │   ├── type TodoTreeNode = z.infer<typeof node>
│       │   │   // 交付前端消费的唯一正式节点类型。
│       │   ├── type TodoTreeState = z.infer<typeof treeState>
│       │   │   // 交付前端消费的完整树、路径存在状态和任务关注数据。
│       │   └── [内] default: {
│       │       todotreeActions: {
│       │         add(options): TodoTreeNode;
│       │         batch(options): TodoTreeNode[];
│       │         del(id: number): number[];
│       │         move(options): TodoTreeNode;
│       │         set(options): TodoTreeNode;
│       │         projectRegister(projectPath: string): TodoTreeProject;
│       │         projectMigrate(options): TodoTreeProject;
│       │         projectAttention(options): Record<number, ProjectAttention>;
│       │         projectList(): TodoTreeNode[];
│       │         projectMaintenance(): {
│       │           projectId: number;
│       │           projectPath: string;
│       │           reason: "path_missing";
│       │         }[];
│       │         projectResolve(workspacePath: string): TodoTreeProject;
│       │         conversationInit(options): {
│       │           projectId: number;
│       │           windowPath: string;
│       │           nodesById: Record<number, TodoTreeNode>;
│       │         };
│       │         taskOpen(options): TodoTreeNode;
│       │         taskOpenMany(options): TodoTreeNode[];
│       │         taskStart(options): TodoTreeNode;
│       │         taskComplete(options): TodoTreeNode;
│       │         taskBlock(options): TodoTreeNode;
│       │         taskCancel(options): TodoTreeNode;
│       │         taskDecision(options): TodoTreeNode;
│       │         projectTree(workspacePath: string): TodoTreeProject;
│       │         projectNodeGet(options): TodoTreeNode;
│       │         projectNodeChildren(options): TodoTreeNode[];
│       │         projectNodeContext(options): TodoTreeProject;
│       │         projectNodeSearch(options): TodoTreeNode[];
│       │         tree(): TodoTreeState;
│       │       };
│       │     }
│       │       // 只维护 todotree_node 原始表，并生产项目、任务、查询和迁移结果。
│       └── index.ts
│           └── default: Register
│               // 交付 TodoTree Hono/MCP 接口与 SSE；调用 contract.templateOptions、store.default.todotreeActions。
├── vite.config.ts                                  // 固定 3005 并构建 todotree
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

```ts
import { hc } from "hono/client";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";

const client = hc<TodoMcpApi>(window.location.origin);
const response = await client["todo-mcp-node"].tree.$get();
const tree = await response.json();
```

TodoTree 页面位于 `http://127.0.0.1:3005/todotree/`，MCP 位于 `http://127.0.0.1:3005/todo-mcp`；SQLite 位于 `join(homedir(), ".store", md5(projectPath), "store.sqlite")`。AI 先调用 `conversation.init` 绑定真实窗口与项目，再用 `task.open` 或 `task.openMany` 建立任务；普通 Hono 页面调用不受 MCP 会话约束。
