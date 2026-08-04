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
│       ├── contract.ts
│       │   ├── statusOptions                       // 交付页面与 MCP 共用的状态数字、待决策/工作中等名称
│       │   ├── templateOptions                     // 交付页面与 MCP 共用的节点模板数字和名称
│       │   └── contractValidator                   // 交付 agent、status 与 template 的唯一验证器
│       ├── index.ts
│       │   └── default: Register
│       │       ├── node.add.POST                    // 新增一个节点并推送正式节点
│       │       ├── node.batch.POST                  // 在一个事务中新增完整节点树
│       │       ├── node.del.POST                    // 删除节点树并推送正式 ID 集合
│       │       ├── node.move.POST                   // 移动节点及其完整子树
│       │       ├── node.set.POST                    // 修改节点并推送正式节点
│       │       ├── conversation.init.POST           // 建立交流节点并绑定当前 MCP session 的在线 AI
│       │       ├── agent.me.POST                    // 读取当前在线 AI 编号、路径和项目
│       │       ├── workspace.tree.POST              // 聚合容器内全部已登记项目及跨项目关系
│       │       ├── workspace.relation.add.POST      // 新增跨项目关系
│       │       ├── workspace.relation.del.POST      // 删除跨项目关系
│       │       ├── project.attention.POST           // 读取项目后代节点派生的关注数量
│       │       ├── project.resolve.POST             // 把任意项目内路径解析到唯一项目
│       │       ├── project.tree.POST                // 读取一个项目的完整树与关注数据
│       │       ├── project.migrate.POST             // 迁移项目地址并保留 ID、子树与跨项目关系
│       │       ├── project.register.POST            // 登记一个真实具体项目
│       │       ├── project.list.GET                 // 读取全部已登记项目
│       │       ├── node.get.POST                    // 读取项目内指定节点
│       │       ├── node.children.POST               // 读取指定节点的直接子节点
│       │       ├── node.context.POST                // 读取指定节点的祖先、当前节点与直接子节点
│       │       ├── node.search.POST                 // 在指定项目内按条件查找节点
│       │       ├── tree.GET                         // 读取 SQLite 生产的完整 TodoTree 数据
│       │       └── events.GET                       // 向页面交付任务树与在线 AI 的 SSE 变化
│       └── store.ts
│           ├── validator                           // 生产接口与 SQLite 共同使用的验证器
│           ├── TodoTreeNode: type                  // 交付正式节点类型
│           ├── TodoTreeState: type                 // 交付正式任务树类型
│           └── default
│               ├── add(options): TodoTreeNode       // 在事务中新增节点
│               ├── batch(options): TodoTreeNode[]   // 在同一事务中新增完整节点树
│               ├── del(id): number[]                // 在事务中删除节点及全部后代
│               ├── move(options): TodoTreeNode      // 在事务中移动节点树
│               ├── set(options): TodoTreeNode       // 在事务中修改并读取正式节点
│               ├── projectMigrate(options)          // 迁移项目路径并保留原项目数据关系
│               └── tree(): TodoTreeState            // 从 SQLite 生产完整任务树
├── vite.config.ts                                  // 固定 3005 并构建 todotree
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

TodoTree 页面位于 `http://127.0.0.1:3005/todotree/`，MCP 位于 `http://127.0.0.1:3005/todo-mcp`；SQLite 位于 `join(homedir(), ".store", md5(projectPath), "store.sqlite")`。项目行显示在线 AI 的 `#编号`，悬停编号可读取该 VS Code 窗口的完整工作路径。
