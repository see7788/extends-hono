import { Hono } from "hono";

const base = new Hono().get("/health", context => context.json({ ok: true }));

export type Routers = typeof base;
export default base;
