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
│   └── todotree/
│       ├── index.ts
│       │   └── default: Register
│       │       ├── node.add.POST                    // 提交事务后新增节点并推送正式节点
│       │       ├── node.del.POST                    // 提交事务后删除节点树并推送正式 ID 集合
│       │       ├── node.set.POST                    // 提交事务后修改节点并推送正式节点
│       │       ├── tree.GET                         // 读取 SQLite 生产的完整 TodoTree 数据
│       │       └── events.GET                       // 向页面交付初始树与后续正式变化
│       └── store.ts
│           ├── validator                           // 生产接口与 SQLite 共同使用的验证器
│           ├── TodoTreeNode: type                  // 交付正式节点类型
│           ├── TodoTreeState: type                 // 交付正式任务树类型
│           └── default
│               ├── add(options): TodoTreeNode      // 在事务中新增节点
│               ├── del(id): number[]              // 在事务中删除节点及全部后代
│               ├── set(options): TodoTreeNode      // 在事务中修改并读取正式节点
│               └── tree(): TodoTreeState           // 从 SQLite 生产完整任务树
├── vite.config.ts                                  // 固定 3005 并构建 todotree
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

TodoTree 页面位于 `http://127.0.0.1:3005/todotree/`，MCP 位于 `http://127.0.0.1:3005/todo-mcp`；SQLite 位于 `join(homedir(), ".store", md5(projectPath), "store.sqlite")`。
