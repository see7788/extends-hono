# todo-mcp-node

`todo-mcp-node` 在一个 Hono 入口中交付 todo-mcp、TodoTree 页面、原 honoapp 模板能力和 create-todo-cli；运行 `pnpm --filter todo-mcp-node dev` 后打开 `http://127.0.0.1:3005/todotree/` 使用。

## 项目结构

```text
todo-mcp-node/
├── src/
│   ├── index.ts
│   │   └── honoServer(router)                       // 启动 Vite 已配置的 Hono 服务
│   ├── routers.ts
│   │   ├── TodoMcpApi: type                        // 供前端 hc 消费完整 Hono 类型
│   │   └── default: Hono                           // 注册 create-todo-cli、honoapp、todotree 与页面
│   ├── store.ts
│   │   └── default: StoreApi<TodoTreeStore>        // 用 cwdPersist、Immer 和切片生产唯一主仓库
│   └── todotree/
│       ├── index.ts
│       │   ├── events: Hono                        // 仓库变化后通过 SSE 推送正式数据
│       │   └── default: Register
│       │       ├── todotree.add.POST               // 新增节点；页面新增子节点时联系工作区 Codex
│       │       ├── todotree.set.POST               // 修改一个节点字段
│       │       └── todotree.tree.GET               // 读取完整 TodoTree 数据
│       └── store.ts
│           ├── validator                           // 生产前后端共同使用的数据与入参验证器
│           ├── TodoTreeStore: type                 // 从 validator 推导前后端共同仓库类型
│           └── default: ImmerStateCreator          // 生产 TodoTree 数据和 action
├── vite.config.ts                                  // 固定 3005/3111 并构建 todotree
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

TodoTree 页面位于 `http://127.0.0.1:3005/todotree/`，MCP 位于 `http://127.0.0.1:3005/todo-mcp`；主仓库通过 `extends-zustand/cwdPersist` 持久化到 `D:\ssdpro\.zustand\todo-mcp-store.json`。
