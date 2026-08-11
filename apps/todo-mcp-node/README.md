# todo-mcp-node

TodoTree 的 Hono/MCP 服务端，为人类和 AI 提供项目树、任务和协作状态接口，同时提供 TodoTree 页面入口。

## 运行

在仓库根目录执行：

```powershell
pnpm --filter todo-mcp-node dev
```

默认监听 `127.0.0.1:3005`。也可以使用项目内 CLI：

```powershell
pnpm --filter todo-mcp-node exec todo-mcp dev
pnpm --filter todo-mcp-node exec todo-mcp stop
pnpm --filter todo-mcp-node exec todo-mcp restart
```

## 入口

- MCP 服务：<http://127.0.0.1:3005/todo-mcp>
- TodoTree 页面：<http://127.0.0.1:3005/todotree/>

服务使用本地 SQLite 持久化 TodoTree 数据，并通过 `extends-zustand/cwdPersist` 写入：
`D:\ssdpro\.zustand\todo-mcp-store.json`。
