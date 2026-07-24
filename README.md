# extends-hono

Register selected MCP integrations on a host-owned MCP server, then mount the handler on Hono.

```ts
import { Hono } from "hono";
import Mcp from "mcp-server/index";

const mcp = new Mcp({ name: "host", version: "1.0.0" });
mcp.mcpRegister("browser");
const app = new Hono().all("/mcp/browser", mcp.honoHandler);
```

`requestToolRegister` accepts one Hono request-tool object. The host owns routing and its HTTP listener.
