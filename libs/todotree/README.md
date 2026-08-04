# todotree

`todotree` 是 TodoTree 的 React 页面，消费服务端唯一 validator、仓库类型和 Hono action；它不生成 ID、不持久化，也不轮询。

## 项目结构

```text
todotree/
├── src/
│   ├── main.tsx                                    // 装配 React 页面
│   ├── routers.tsx                                 // 生产 Tree 与节点抽屉的 Hash 路由
│   ├── store.ts
│   │   └── default: StoreApi<TodoTreeStore>        // 组合 TodoTree 页面切片
│   └── todotree/
│       ├── store.ts
│       │   └── default: ImmerStateCreator<TodoTreeStore>
│       │                                              // 接收任务树、最近节点和在线 AI 的 SSE
│       ├── index.tsx                                  // 虚拟渲染 Tree、筛选、排序及在线 AI 编号
│       ├── Title.tsx                                  // 按节点 template 呈现标题
│       └── Drawer.tsx                                 // 呈现并修改当前节点
├── index.html                                      // Vite 页面入口
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

打开 `http://127.0.0.1:3005/todotree/`；页面与 AI MCP 消费同一组 TodoTree Hono action，服务端通过 SSE 主动交付任务树和在线 AI 变化。右下角方形悬浮按钮组可按路径、状态或编号排序；路径排序会让同一 pnpm 容器内的项目相邻。
