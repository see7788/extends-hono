# mcp-server

`mcp-server` 把项目内 Hono 动作与外部 npm MCP 产品统一挂载到一个 `/todo-mcp` Streamable HTTP 端点。

## 源码结构

```text
libs/mcpServer/
├── index.ts
│   └── default Mcp
│       ├── new Mcp(options)                                 # 创建 MCP 母库实例并装配内置功能
│       ├── mcp.register(namespace, register)                # 增加项目内功能；调用 public.ts.honoMount(...)
│       ├── mcp.registerFromNpm(name)                        # 启用外部 MCP；调用 mcpFromNpm/public.ts.mount(...)
│       └── mcp.hono                                        # 提供给外部 Hono.route(...) 挂载的路由
│           ├── ALL /todo-mcp                               # MCP 调用入口
│           └── GET /todo-mcp2/overview                     # 人类工具概览入口
├── mcp/
│   ├── ai-call-ai/                                    # 让不同工作区的 Codex 交换联系卡和消息
│   ├── overview.ts                                    # 提供工具搜索和单项工具契约
│   └── watcher.ts                                     # 提供 watcher 定义、报告和生命周期接口
├── mcpFromNpm/
│   ├── browser.ts                                     # 接入浏览器 MCP
│   ├── codegraph.ts                                   # 接入源码关系 MCP
│   ├── docs.ts                                        # 接入第三方文档 MCP
│   ├── io.ts                                          # 接入受限文件系统 MCP
│   ├── workspace.ts                                   # 接入本机工作区 MCP
│   └── public.ts
│       └── default RegisterFromNpm                    # 外部 MCP 接入配件
│           ├── register(...)                          # 登记外部 MCP 的名称、连接和说明
│           ├── replace(...)                           # 调整指定外部工具的公开契约
│           ├── add(...)                               # 增加随外部 MCP 一起提供的项目内功能
│           ├── mount(...)                             # 连接外部 MCP 并挂载附加 Hono 路由
│           ├── serverMount(...)                       # 把已连接工具注册到 McpServer
│           └── toolsGet(...)                          # 生成当前外部 MCP 的工具概览数据
├── public.ts
│   └── default Register                              # 项目内 Hono 功能配件
│       ├── register(...)                              # 登记一个 Hono 动作
│       ├── honoMount(...)                             # 挂载 Hono 路由；调用 Hono.route(...)
│       ├── serverMount(...)                           # 注册 MCP 工具；调用 McpServer.registerTool(...)
│       └── toolsGet(...)                              # 生成工具概览数据
├── log.txt                                            # 运行时自动追加 Hono 接口错误
├── package.json
└── tsconfig.json
```

## 核心实现

```ts
import { Hono } from "hono";
import Mcp from "mcp-server/index.ts";
import todocli from "mcpCreate/index.ts";
import pkg from "../package.json";
import tpl from "./tpl";

const mcp = new Mcp({ name: pkg.name, version: pkg.version })
  .register("create-todo-cli", todocli)
  .register("honoapp", tpl);

const router = new Hono()
  .route("/", mcp.hono);
```

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import WORKSPACE_AI_CONTACT, {
  cardSchema,
  inputSchema,
} from "mcp-server/mcp/ai-call-ai/WORKSPACE_AI_CONTACT.ts";

const workspaceAiContact = WORKSPACE_AI_CONTACT;

new Hono().get("/", zValidator("query", cardSchema), async context => {
  const input = context.req.valid("query");
  try {
    return context.text(
      await workspaceAiContact.card(input.workspacePath),
    );
  } catch (error) {
    return context.text(
      error instanceof Error ? error.message : String(error),
      409,
    );
  }
});

new Hono().post("/", zValidator("json", inputSchema), async context => {
  const input = context.req.valid("json");
  try {
    const senderContact = await workspaceAiContact.card(
      input.senderWorkspacePath,
    );
    return context.text(await workspaceAiContact.input({
      workspacePath: input.workspacePath,
      remoteDebuggingPort: input.remoteDebuggingPort,
      message: [
        `【来自 ${input.senderWorkspacePath} 路径的 AI】`,
        input.message,
        "",
        "你回复我时，执行以下联系卡：",
        senderContact,
      ].join("\n"),
    }));
  } catch (error) {
    return context.text(
      error instanceof Error ? error.message : String(error),
      502,
    );
  }
});
```

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import RegisterFromNpm from "mcp-server/mcpFromNpm/public.ts";

const mcp = new RegisterFromNpm().register({
  namespace: "docs",
  transport: () => new StreamableHTTPClientTransport(
    new URL("https://mcp.context7.com/mcp"),
  ),
});

export default mcp;
```

## 接口与调用

- MCP 地址：`http://127.0.0.1:3005/todo-mcp`
- 人类工具概览：`http://127.0.0.1:3005/todo-mcp2/overview`
- 项目内 Hono 功能同时生成扁平 MCP tool name：`namespace.path.METHOD`
- browser、codegraph、docs、io、workspace 保留各自现有 namespace 和原生工具名。

`GET /todo-mcp2/overview` 与 `todo-mcp2.overview.GET` 使用同一个输入契约：

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `name` | 无 | 按完整工具名返回一个完整工具契约；找不到时返回 404 |
| `query` | 无 | 在工具名和用途描述中搜索 |
| `offset` | `0` | 名称结果的分页起点 |
| `limit` | `20` | 本次最多返回的名称数量，最大为 `50` |

不传参数时只返回第一页轻量名称。AI 应先通过 `query` 发现名称，再通过 `name` 读取单个完整契约，避免一次请求全部 schema。

示例地址：

```text
http://127.0.0.1:3005/todo-mcp2/overview?query=browser&limit=10
http://127.0.0.1:3005/todo-mcp2/overview?name=browser.list_pages
```

## 运行语义

- 每个 `Mcp` 实例独立建立外部 MCP 连接并保存工具目录和调用函数，不与其他 `Mcp` 实例串状态。
- 同一产品的并发首次连接复用同一个 `productMount` Promise，不重复启动外部进程。
- 任一外部 MCP 启动失败时，`/todo-mcp` 和工具概览直接失败；失败状态会清除，`registerFromNpm(name)` 可显式重试。
- Hono 接口异常会把请求方法、接口路径和完整原始错误追加到 `libs/mcpServer/log.txt`，不把失败响应改写成成功。
- overview 每次读取当前实例实际注册的工具，晚于构造发生的 `register(...)` 也会进入结果。
- 多个 AI 可以同时访问同一个 `/todo-mcp`；它们共享该 `Mcp` 实例背后的 browser、io、workspace 等外部产品状态，不提供每个 AI 独立的浏览器或文件系统副本。
- 当前公开接口没有关闭方法；成功建立的外部 MCP 连接随宿主进程生命周期结束；连接失败时立即关闭对应 Transport，关闭也失败时同时抛出两个错误。
- MCP 客户端通常缓存工具描述和 input schema；服务热更新后需要重新连接 MCP 或创建新会话才能刷新客户端元数据。
