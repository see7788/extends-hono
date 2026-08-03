# apps

`apps` 放置可以独立启动和直接交付给使用者的成品，不以是否被其他源码调用判断价值。目前保留两个远程控制产品；`todo-mcp` 计划迁入这里，作为统一 MCP、Hono、主仓库和 TodoTree 的独立入口。现有项目可分别使用 `pnpm --filter remotedemo dev` 和 `pnpm --filter remotedemo2 dev` 启动。

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
└── todo-mcp/                                # 计划迁入，当前尚未创建
    └── 目标                                 # 替代 honoapp 的 todo-mcp 启动职责
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

### todo-mcp 迁移目标

`todo-mcp` 将从 `libs/mcpServer` 迁入 `apps/todo-mcp`，直接运行未编译 TypeScript 源码并替代 honoapp 入口；唯一主仓库数据写入 `D:\ssdpro\todo-mcp-store`。迁移完成并通过真实运行验收前，现有入口和源码仍是当前事实，不提前删除。
