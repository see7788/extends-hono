# apps

`apps` 放置可以独立启动和直接交付给使用者的成品，不以是否被其他源码调用判断价值。目前包含两个远程控制产品和新的 TodoTree MCP 服务；新服务完成运行验收前不替换旧 honoapp 进程。

## 项目结构

```text
apps/
├── remotedemo/
│   ├── src/
│   │   ├── index.ts                         # Codex WebView 远程控制服务入口
│   │   │   ├── GET /remote                 # 提供远程画面与操作页面
│   │   │   ├── GET /remote/events          # 通过 SSE 交付 Codex WebView 实时画面
│   │   │   └── POST /remote/action         # 接收鼠标、键盘和文本操作
│   │   └── RemoteWeb.ts                     # 连接 VS Code CDP 并生产画面与输入能力
│   └── package.json
│       ├── pnpm dev                         # 监听源码并启动 127.0.0.1:3010
│       └── pnpm start                       # 直接运行 TypeScript 源码
├── remotedemo2/
│   ├── src/
│   │   ├── index.ts                         # WebRTC 浏览器远程协助服务入口
│   │   │   ├── GET /                       # 提供协助者控制页面
│   │   │   └── GET /remote.js              # 交付被协助页面的注入脚本
│   │   └── remote.js                        # 共享当前标签页并接收远程操作
│   ├── vite.config.ts                       # 注入信令、STUN 与控制服务配置
│   └── package.json
│       ├── pnpm dev                         # 构建注入脚本并监听服务源码
│       └── pnpm start                       # 构建后启动 127.0.0.1:32223
└── todo-mcp-node/
    ├── src/                                 # TodoTree 仓库、Hono、MCP、Codex 联系与 SSE
    ├── vite.config.ts                       # 同时构建 Node 服务与 todotree
    └── package.json
        ├── pnpm dev                         # 使用 3005/3111 启动统一开发服务
        └── pnpm build                       # 构建 React 与 Node 两份产物
```

## 核心使用方法

### Codex WebView 远程控制

```powershell
pnpm --filter remotedemo dev
```

打开 `http://127.0.0.1:3010/remote`，页面连接当前工作区唯一可见的 Codex WebView，并把网页中的鼠标、键盘和文本操作交付给该 WebView。

### WebRTC 浏览器远程协助

```powershell
pnpm --filter remotedemo2 dev
```

服务在 `http://127.0.0.1:32223` 提供控制页面，在 `http://127.0.0.1:32223/remote.js` 提供被协助页面脚本。脚本启动当前标签页共享后生成控制地址，协助者打开该地址查看画面并执行鼠标、键盘和文本操作。

### TodoTree MCP

```powershell
pnpm --filter todo-mcp-node dev
```

服务计划在 `http://127.0.0.1:3005/todo-mcp` 提供唯一 MCP，在 `/todotree/` 提供 TodoTree 页面；唯一服务端仓库通过 `extends-zustand/cwdPersist` 写入 `D:\ssdpro\.zustand\todo-mcp-store.json`。新入口已经消费原 honoapp 模板能力与 create-todo-cli，完成运行验收前仍不切换 3005 进程。
