# extends-hono

`extends-hono` 提供两组可独立消费的 TypeScript 工具：`vite.config` 用一个 Vite 配置同时开发或构建 Hono 与多个 React 项目；`mcp-server` 把自建 Hono 接口和已有 MCP 产品汇入同一个应用级 MCP endpoint。各消费项目通过 pnpm workspace 引入对应 package。

最短的自建 MCP 使用方式如下。`Register` 中的 Hono 同时是 HTTP 实现和 MCP 工具实现；`Mcp` 只负责命名空间隔离、最终 Hono 挂载和 MCP server。

```ts
import { Hono } from "hono";
import Mcp from "mcp-server/index.ts";
import Register from "mcp-server/public.ts";
import { z } from "zod";

const health = new Register().register(
  "/health",
  new Hono().get("/", context => context.json({ ok: true })),
  z.object({}),
  "读取应用健康状态。",
);

const mcp = new Mcp({ name: "honoapp", version: "1.0.0" })
  .register("honoapp", health);

export default new Hono().route("/", mcp.hono);
```

该示例同时得到：

- Hono 接口：`GET /honoapp/health`
- MCP 工具：`honoapp.health.GET`
- MCP endpoint：`/mcp`

## 项目结构

```text
libs/
├── vite.config/
│   ├── vite.ts                 # 生产完整 Vite 配置函数
│   ├── plugin.ts               # 生产可组合的 Hono + React Vite 插件
│   ├── honoServer.ts           # 生产支持 WebSocket 注入的 Hono Node server
│   ├── url.ts                  # 生产前后端共用的项目 URL 读取方法
│   └── README.md               # vite.config 的详细使用说明
└── mcpServer/
    ├── index.ts                # 生产 Mcp
    │   ├── register()          # 挂载一个自建 Register，并增加命名空间
    │   ├── registerFromNpm()   # 连接并挂载一个包内成品 MCP
    │   └── hono                # 完整 Hono router，包含业务接口与 /mcp
    ├── public.ts               # 生产 Register
    │   ├── register()          # 收集一个单路由 Hono、输入 schema 和工具说明
    │   └── mount()             # 同时挂载 Hono route 与 MCP tool
    └── mcpFromNpm/
        ├── public.ts           # 生产包内 RegisterFromNpm 成品装配器
        │   ├── register()      # 接收 namespace 与 MCP Transport
        │   ├── replace()       # 修正上游工具的公开元数据
        │   ├── add()           # 增加成品自身维护的 Hono/MCP 接口
        │   └── mount()         # 连接上游、代理工具并挂载附加接口
        ├── workspace.ts        # Desktop Commander：文件、搜索、终端与进程
        ├── browser.ts          # Chrome DevTools：页面、控制台、网络与性能
        ├── docs.ts             # Context7：当前版本库文档
        └── codegraph.ts        # CodeGraph：源码、调用链与影响范围
```

## Vite 与 Hono

直接配置：

```ts
import viteConfig from "vite.config/vite";

export default viteConfig(
  {
    honoEntry: "src/index.ts",
    honoHost: "127.0.0.1",
    honoPort: 3005,
  },
  "../reactapp",
);
```

需要与其他 Vite 插件组合时，改用 `vite.config/plugin`。开发时由 Hono 提供对外地址，React 开发服务和 HMR 由 Vite 管理；生产时每个 React 项目输出到 `dist/<package.name>`。完整配置见 [`libs/vite.config/README.md`](libs/vite.config/README.md)。

## 自建 MCP

`Register.register()` 一次定义一个动作：

```ts
register(
  path,
  new Hono().get("/", handler),
  inputSchema,
  description,
  annotations,
);
```

约束如下：

- `path` 是动作的稳定业务路径。
- 传入的 Hono 只表达该动作自身的 `/` 路由和一个 HTTP method。
- `inputSchema` 同时作为 MCP 工具输入约束。
- 工具名称固定为 `<namespace>.<path 转点号>.<HTTP METHOD>`。
- GET/HEAD 参数进入 query，其他 method 参数以 JSON body 调用同进程 Hono。
- 同一份 handler 可以被页面通过 Hono 类型消费，也可以被 MCP 客户端消费，不复制业务实现。

多个业务碎片在应用最终 router 中统一隔离：

```ts
const mcp = new Mcp({ name: "honoapp", version: "1.0.0" })
  .register("create-todo-cli", todocli)
  .register("honoapp", tpl);

const router = new Hono().route("/", mcp.hono);
```

## 成品 MCP

应用按名称选择包内已经验证的成品：

```ts
const mcp = await new Mcp({ name: "honoapp", version: "1.0.0" })
  .register("honoapp", tpl)
  .registerFromNpm("workspace");
```

| 名称 | 上游 | Transport | 当前职责 |
| --- | --- | --- | --- |
| `workspace` | `@wonderwhy-er/desktop-commander@0.2.46` | stdio | 文件、目录、搜索、编辑、终端和进程 |
| `browser` | `chrome-devtools-mcp@1.5.0` | stdio | Chrome 页面、DOM、控制台、网络、截图和性能 |
| `docs` | `https://mcp.context7.com/mcp` | Streamable HTTP | 解析库标识并查询当前文档 |
| `codegraph` | `@colbymchenry/codegraph@1.4.1` | stdio | 读取源码关系、调用路径和修改影响范围 |

`RegisterFromNpm` 接收 MCP SDK 的 `Transport`，因此来源不限定为 npm：本地可执行程序、HTTP 服务、进程内 MCP，以及其他语言实现的 MCP 都可以使用同一个装配入口。成品若还要维护自己的配置接口，使用 `add()` 挂载一个真实 `Register`，继续复用相同命名空间和 Hono/MCP 双入口。

## 进程与生命周期

- `Mcp` 为一个应用创建一个 `McpServer`、一个最终 Hono router 和一个 `/mcp` Streamable HTTP transport。
- `register()` 只挂载同进程 Hono，不创建外部进程。
- `registerFromNpm()` 会立即创建上游 MCP client、连接 transport、读取工具清单并完成代理。
- `workspace`、`browser` 和 `codegraph` 会启动子进程；`docs` 建立远端 HTTP 连接。
- `browser` 还会启动隔离、无界面的 Chrome 实例。无界面不等于不使用 GPU。

当前 `RegisterFromNpm.mount()` 把上游 client 保存在工具闭包中，但还没有由应用 owner 调用的关闭入口。因此成品连接目前适合应用全生命周期使用，不适合在短测试中反复挂载后用 `process.exit()` 强制结束。

浏览器验证应满足以下条件后再执行：

1. 上游 MCP client、stdio transport 和 Chrome 都有可等待的正常关闭链。
2. 测试实例与用户浏览器隔离，并记录创建者、进程和退出条件。
3. 显卡或桌面合成器不稳定的机器先通过 Chrome `--chromeArg=--disable-gpu` 使用软件渲染。
4. 验证完成后确认本次创建的 Node、MCP 和 Chrome 进程都已退出。

宿主跨进程通信不由本包重复实现。Electron IPC、fork process、VS Code plugin、WebRTC 和 Worker 边界可以消费相邻 `remote-runtimeobj` 中对应的 typed proxy；它们负责宿主通信，MCP Transport 继续负责 MCP 协议。

## 已验证范围

当前实现已经完成以下验证：

- `mcp-server` TypeScript 严格类型检查。
- 自建 GET/POST Hono route 与 MCP 工具的同源挂载。
- 进程内 MCP、stdio MCP 和 Streamable HTTP MCP 的工具代理。
- `workspace.list_sessions`、`browser.list_pages`、`docs.resolve-library-id` 和 `codegraph.explore` 的真实调用。
- `extends-electron-vite/apps/honoapp` 与 `create-todo-cli/mcpCreate` 两个外部消费者的 TypeScript 回归。

上述验证证明接线和工具调用成立，不代表外部进程生命周期已经闭环；生命周期限制以“进程与生命周期”一节为准。
