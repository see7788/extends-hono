# mcp-server

`mcp-server` 把项目内 Hono 动作与外部 npm MCP 产品统一挂载到一个 `/todo-mcp` Streamable HTTP 端点，并通过 `workcopy` 工具安全管理机械盘项目在 `D:\ssdpro` 的 SSD 工作副本与源码回迁。

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
│   ├── error.ts                                       # 生产并持久化 MCP 接口错误切片
│   ├── overview.ts                                    # 提供工具搜索和单项工具契约
│   ├── watcher.ts                                     # 提供 watcher 定义、报告和生命周期接口
│   └── workcopy/
│       ├── index.ts                                   # 提供 SSD 工作副本业务接口
│       │   ├── workcopy.create.POST                   # 创建并校验工作副本，登记 creating/developing
│       │   ├── workcopy.status.GET                    # 查询全部账本或单个项目的实时差异与冲突
│       │   └── workcopy.sync.POST                     # 校验后回迁新增和修改；只删除明确授权路径
│       └── store.ts                                   # 生产 workcopy 数据与 action 切片
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
│           ├── healthAudit()                          # 检查已登记 stdio child 与 transport 状态；调用 close()
│           ├── close()                                # 精确关闭当前实例持有的 Client 与 Transport
│           ├── serverMount(...)                       # 把已连接工具注册到 McpServer
│           └── toolsGet(...)                          # 生成当前外部 MCP 的工具概览数据
├── public.ts
│   └── default Register                              # 项目内 Hono 功能配件
│       ├── register(...)                              # 登记一个 Hono 动作
│       ├── honoMount(...)                             # 挂载 Hono 路由；调用 Hono.route(...)
│       ├── serverMount(...)                           # 注册 MCP 工具；调用 McpServer.registerTool(...)
│       └── toolsGet(...)                              # 生成工具概览数据
├── store/
│   ├── index.ts                                       # 唯一 Zustand 主仓库，组合切片并持久化数据
│   └── type.ts                                        # 定义完整 Store 数据与 Actions 契约
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
import { HTTPException } from "hono/http-exception";
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
    throw new HTTPException(409, {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
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
    throw new HTTPException(502, {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
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
- `workcopy.create.POST` 只在方先生授权后接收原项目绝对 `sourcePath`，目标固定为 `D:\ssdpro\<项目名>`。
- `workcopy.status.GET` 的 `sourcePath` 可选；省略时检查全部登记项目，提供时返回单个项目的文件差异与冲突。
- `workcopy.sync.POST` 接收 `sourcePath` 和可选 `deletePaths`；新增与修改直接回迁，原项目文件默认不删除。

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
- Hono 接口异常通过 `mcpErrorActions.errorAdd(...)` 进入唯一主仓库，不把失败响应改写成成功。
- 主仓库只持久化数据切片并过滤 Actions，文件固定为 `D:\ssdpro\.todo-mcp\store.json`；写入使用 next/backup 交替并在启动时恢复有效副本。
- workcopy 账本记录原路径、SSD 路径、文件基线、阶段、更新时间和最近错误；`creating`、`developing`、`syncing`、`synced` 可在电脑重启后继续检查。
- 工作副本排除依赖、构建物、缓存、日志和特殊文件；复制后用 SHA-256 清单验证，双方同时修改同一文件时禁止回迁。
- overview 每次读取当前实例实际注册的工具，晚于构造发生的 `register(...)` 也会进入结果。
- 多个 AI 可以同时访问同一个 `/todo-mcp`；它们共享该 `Mcp` 实例背后的 browser、io、workspace 等外部产品状态，不提供每个 AI 独立的浏览器或文件系统副本。
- 总入口每 20 秒调用各外部产品的 `healthAudit()`；只检查已登记的 stdio child 与 transport，失效后调用同一实例的 `close()` 并移除产品，不扫描进程名、端口或命令行。
- 成功建立的外部 MCP 连接由 `RegisterFromNpm.close()` 精确关闭；连接失败时立即关闭对应 Transport，关闭也失败时同时抛出两个错误。
- MCP 客户端通常缓存工具描述和 input schema；服务热更新后需要重新连接 MCP 或创建新会话才能刷新客户端元数据。
