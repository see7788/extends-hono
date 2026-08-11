import { Hono } from "hono";
import tpl from "honoapp/src/tpl/index";
import Mcp from "mcp-server-lib/index.ts";
import todotree from "./todotree/index.ts";

const mcp = new Mcp()
  .register(tpl)
  .register(todotree)

const router = new Hono()
  .get("/favicon.ico", context => context.body(null, 204))
  .route("/", mcp.hono);

export type TodoMcpApi = typeof router;

export default router;
