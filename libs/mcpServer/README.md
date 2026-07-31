# mcp-server

`mcp-server` 把项目内 Hono 动作与外部 npm MCP 产品统一挂载到一个 `/todo-mcp` Streamable HTTP 端点。

## 源码结构

```text
libs/mcpServer/
├── index.ts
│   └── default Mcp
│       ├── new Mcp(options)                          # 装配内置功能并创建 /todo-mcp
│       │   ├── mcp.ai-call-ai.index.aiCallAi.mount(...)
│       │   ├── mcp.watcher.watcher.mount(...)
│       │   └── mcpFromNpm.[browser|codegraph|docs|io|workspace].mount(...)
│       ├── mcp.register(namespace, register)         # 增加项目内功能
│       │   └── public.mount(...)
│       ├── mcp.registerFromNpm(name)                 # 连接指定外部 MCP
│       │   └── mcpFromNpm.public.mount(...)
│       └── mcp.hono
│           ├── ALL /todo-mcp                         # 唯一 MCP HTTP 入口
│           └── extends-electron-vite.apps.honoapp.src.routers.route("/", mcp.hono)
├── mcp/                                             # 现在及以后供人类直接使用的 Hono 路由统一挂载到 /todo-mcp2/<功能>；AI 仍使用各自扁平 tool name
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
│   │   └── default overview
│   │       └── GET /todo-mcp2/overview              # AI 使用 todo-mcp2.overview.GET 读取全部实际注册工具
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
│           ├── register(...)
│           ├── replace(...)
│           ├── add(...)
│           └── mount(...)
├── public.ts
│   └── default Register                              # 项目内 Hono 功能配件
│       ├── register(...)
│       └── mount(...)
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

const workspaceAiContact = new WORKSPACE_AI_CONTACT();

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
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm().register({
  namespace: "docs",
  transport: () => new StreamableHTTPClientTransport(
    new URL("https://mcp.context7.com/mcp"),
  ),
});

export default mcp;
```

## 内部调用改进

```text
libs/mcpServer/
├── index.ts
│   └── default Mcp
│       ├── new Mcp(options)                                 # 公开参数和创建方式不变
│       │   ├── productMount(name)                           # 每个外部 MCP 独立连接、复用进行中的连接
│       │   │   ├── success                                 # 保存当前产品可用状态
│       │   │   └── failure                                 # 清除失败状态，下次调用允许重试
│       │   ├── overviewToolsGet()                           # 每次读取当前实际可用 tools
│       │   └── createMcpHandler(...)                        # 只装配已经成功连接的产品
│       ├── mcp.register(namespace, register)                # 方法、参数和返回方式不变
│       ├── mcp.registerFromNpm(name)                        # 方法、参数和返回方式不变
│       └── mcp.hono
│           ├── ALL /todo-mcp                               # MCP 地址不变
│           └── GET /todo-mcp2/overview                     # 人类查看地址不变
├── mcp/
│   ├── ai-call-ai/
│   │   └── default aiCallAi                                 # 文件、路由和 tool name 不变
│   ├── overview.ts
│   │   └── default overview
│   │       ├── toolsSet(...)                                # 接收当前工具读取入口，不固化一次性失败
│   │       └── GET /todo-mcp2/overview
│   │           ├── name                                    # 精确返回一个完整工具契约
│   │           ├── query                                   # 按名称和描述筛选
│   │           ├── offset                                  # 分页起点
│   │           └── limit                                   # 默认 20，最多 50
│   ├── watcher.ts
│   │   └── default watcher
│   │       ├── GET /watcher/definition                     # 调用和返回不变
│   │       ├── POST /watcher/report                        # 调用和返回不变
│   │       └── POST /watcher/lifecycle                     # 移除调试前缀，只输出约定 rawText
│   └── 其他现有功能                                         # 不改文件、路由和 namespace.path.METHOD
├── mcpFromNpm/
│   ├── browser.ts                                           # 启动参数、transport 和 browser.* names 不变
│   ├── codegraph.ts                                         # 启动参数、transport 和 codegraph.* names 不变
│   ├── docs.ts                                              # 远端地址、transport 和 docs.* names 不变
│   ├── io.ts                                                # 允许目录、transport 和 io.* names 不变
│   ├── workspace.ts                                         # 启动参数、transport 和 workspace.* names 不变
│   └── public.ts
│       └── default RegisterFromNpm
│           ├── register(...)
│           ├── replace(...)
│           ├── add(...)
│           ├── mount(...)
│           │   ├── Client                                  # 保存真实连接，不再只保存 toolCall
│           │   ├── Transport                               # 保存真实 transport
│           │   └── tools                                   # 当前产品自己的工具目录
│           ├── serverMount(...)
│           └── toolsGet(...)
├── public.ts
│   └── default Register                                     # Class、方法、参数和工具命名规则不变
│       ├── register(...)
│       ├── honoMount(...)
│       ├── serverMount(...)
│       └── toolsGet(...)
├── package.json
└── tsconfig.json
```
