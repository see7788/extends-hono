# todotree

`todotree` 是 TodoTree 的 React 页面，消费服务端唯一 validator、仓库类型和 Hono action；它不生成 ID、不持久化，也不轮询。

## 项目结构

```text
todotree/
├── src/
│   ├── main.tsx                                    // 装配 React 页面
│   ├── store.ts
│   │   └── default: StoreApi<TodoTreeStore>        // 消费共享切片并接收首次完整树和后续节点 SSE
│   ├── style.css                                   // 页面布局与树层级样式
│   └── todotree/
│       └── index.tsx                               // 呈现页面并用 hc 调用节点接口
├── index.html                                      // Vite 页面入口
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

打开 `http://127.0.0.1:3005/todotree/`；页面与 AI MCP 消费同一组 TodoTree Hono action，服务端数据变化后通过 SSE 主动交付最新任务树。
