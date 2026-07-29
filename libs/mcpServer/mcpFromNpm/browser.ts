import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";
import RegisterFromNpm from "./public";

const mcp = new RegisterFromNpm().register({
  namespace: "browser",
  transport: () => new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@1.5.0",
      "--headless=true",
      "--isolated=true",
      "--no-usage-statistics",
      "--no-performance-crux",
    ],
  }),
}).add(toolCall => new Register().register(
  "/environment/check",
  new Hono().get("/", async context => {
    try {
      const result = await toolCall("list_pages", {});
      if (result.isError) {
        const errors = result.content.flatMap(content => content.type === "text" ? [content.text] : []);
        return context.text(JSON.stringify(
          errors.length ? errors : ["browser.list_pages failed"],
        ));
      }
      return context.text("[]");
    } catch (error) {
      return context.text(JSON.stringify([
        error instanceof Error ? error.message : String(error),
      ]));
    }
  }),
  z.object({}),
  "Checks MCP environment capabilities and reports unresolved external issues.",
));

export default mcp;
