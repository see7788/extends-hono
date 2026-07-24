# extends-hono

Register selected MCP integrations on a host-owned MCP server, then mount the handler on Hono.

```ts
import { Hono } from "hono";
import Mcp from "extends-hono/createMcpServer/index";

const mcp = new Mcp({ name: "host", version: "1.0.0" });
mcp.mcpRegister("browser");
const app = new Hono().route("/mcp/browser", mcp.routeMount());
```

`requestToolRegister` accepts one Hono request-tool object. The host owns routing and its HTTP listener.
