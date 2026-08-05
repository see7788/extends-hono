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
│       ├── index.tsx                                  // 虚拟渲染 Tree、筛选及在线 AI 编号；同级节点默认标题升序
│       ├── Title.tsx                                  // 按节点 template 呈现标题
│       └── Drawer.tsx                                 // 呈现并修改当前节点
├── index.html                                      // Vite 页面入口
└── package.json
```

## 核心使用方法

```powershell
pnpm --filter todo-mcp-node dev
```

打开 `http://127.0.0.1:3005/todotree/`；页面与 AI MCP 消费同一组 TodoTree Hono action，服务端通过 SSE 主动交付任务树和在线 AI 变化。所有同级节点默认按标题升序排列，树的父子关系不变；右下角方形悬浮按钮组只负责筛选。
