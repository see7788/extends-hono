# mcp-server

`mcp-server` 把项目内 Hono 动作与外部 npm MCP 产品统一挂载到一个 `/todo-mcp` Streamable HTTP 端点。

## 源码结构

```text
libs/mcpServer/
├── index.ts
│   └── default Mcp
│       ├── new Mcp(options)                                 # 创建当前实例的内置功能、外部产品和 /todo-mcp
│       │   ├── productMount(name)                           # 复用进行中的连接，失败后允许重试
│       │   ├── overviewToolsGet()                           # 读取当前实例实际可用的 tools
│       │   └── createMcpHandler(...)                        # 只装配成功连接的外部产品
│       ├── mcp.register(namespace, register)                # 增加项目内 Hono/MCP 功能
│       ├── mcp.registerFromNpm(name)                        # 确认或重试指定外部 MCP
│       └── mcp.hono
│           ├── ALL /todo-mcp                               # 唯一 MCP Streamable HTTP 入口
│           ├── GET /todo-mcp2/overview                     # 人类工具概览入口
│           └── extends-electron-vite.apps.honoapp.src.routers.route("/", mcp.hono)
├── mcp/
│   ├── ai-call-ai/
│   │   ├── index.ts
│   │   │   └── default aiCallAi
│   │   │       ├── GET /ai-call-ai/WORKSPACE_AI_CONTACT      # 创建名片
│   │   │       │   └── mcp.ai-call-ai.WORKSPACE_AI_CONTACT.card(...)
│   │   │       └── POST /ai-call-ai/WORKSPACE_AI_CONTACT     # 向目标 Codex 发送消息
│   │   │           └── mcp.ai-call-ai.WORKSPACE_AI_CONTACT.input(...)
│   │   └── WORKSPACE_AI_CONTACT.ts
│   │       ├── cardSchema
│   │       ├── inputSchema
│   │       └── default WORKSPACE_AI_CONTACT          # 让本机不同工作区的 VS Code Codex 交换联系卡和消息
│   │           ├── card(workspacePath)                # 发现热窗口并生成联系卡
│   │           └── input(input)                       # 替换输入框内容并提交
│   ├── overview.ts
│   │   ├── Overview
│   │   │   ├── toolsSet(...)                          # 接收当前实例的工具读取入口
│   │   │   └── GET /todo-mcp2/overview
│   │   │       ├── name                               # 精确返回一个完整工具契约
│   │   │       ├── query                              # 按名称和用途搜索
│   │   │       ├── offset                             # 分页起点，默认 0
│   │   │       └── limit                              # 返回数量，默认 20，最多 50
│   │   └── default overview                           # 保留默认实例导出
│   └── watcher.ts
│       └── default watcher
│           ├── GET /watcher/definition               # 生成 watcher 启动定义
│           ├── POST /watcher/report                  # 输出规范化异常报告
│           └── POST /watcher/lifecycle               # 输出 online/offline 生命周期
├── mcpFromNpm/
│   ├── browser.ts
│   │   └── default browser                           # 控制隔离浏览器的页面交互、调试和性能审计
│   │       ├── browser.list_pages 等浏览器原生 tools
│   │       └── GET /browser/environment/check
│   ├── codegraph.ts
│   │   └── default codegraph                         # 查询源码符号、调用链和修改影响范围
│   │       ├── codegraph.explore
│   │       └── GET /codegraph/scope_maintenance
│   ├── docs.ts
│   │   └── default docs                              # 查询第三方库的最新文档和代码示例
│   │       ├── docs.resolve-library-id
│   │       └── docs.query-docs
│   ├── io.ts
│   │   └── default io                                # 在允许的项目根目录内读取、写入、编辑、搜索和移动文件
│   │       └── io.read_text_file、io.write_file 等官方 filesystem tools
│   ├── workspace.ts
│   │   └── default workspace                         # 管理本机文件、目录、命令和进程
│   │       └── workspace.read_file、workspace.write_file 等 Desktop Commander tools
│   └── public.ts
│       └── default RegisterFromNpm                   # 外部 MCP 代理配件
│           ├── Client / Transport / tools             # 当前 Mcp 实例独立保存连接与工具目录
│           ├── register(...)
│           ├── replace(...)
│           ├── add(...)
│           ├── mount(...)
│           ├── serverMount(...)
│           └── toolsGet(...)
├── public.ts
│   └── default Register                              # 项目内 Hono 功能配件
│       ├── register(...)
│       ├── honoMount(...)
│       ├── serverMount(...)
│       └── toolsGet(...)
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

- 每个 `Mcp` 实例独立持有外部 MCP 的 `Client`、`Transport`、工具目录和调用函数，不与其他 `Mcp` 实例串状态。
- 同一产品的并发首次连接复用同一个 `productMount` Promise，不重复启动外部进程。
- 单个外部 MCP 启动失败时会输出明确错误、清除失败状态并允许 `registerFromNpm(name)` 重试；其他已成功产品和 `/todo-mcp` 继续可用。
- overview 每次读取当前实例实际注册的工具，晚于构造发生的 `register(...)` 也会进入结果。
- 多个 AI 可以同时访问同一个 `/todo-mcp`；它们共享该 `Mcp` 实例背后的 browser、io、workspace 等外部产品状态，不提供每个 AI 独立的浏览器或文件系统副本。
- 当前公开接口没有关闭方法；成功建立的外部 MCP 连接随宿主进程生命周期结束，连接失败时会立即关闭对应 Transport。
- MCP 客户端通常缓存工具描述和 input schema；服务热更新后需要重新连接 MCP 或创建新会话才能刷新客户端元数据。
