import { Hono } from "hono";

const routers = new Hono().get("/health", context => context.json({ ok: true }));

export type Routers = typeof routers;
export default routers;
