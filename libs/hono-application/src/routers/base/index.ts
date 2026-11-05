import { Hono } from "hono";
// import store from "../../store"
// import zod from "./zod"
// 不允许直接消费切片store
export default new Hono().get("/", context => context.json({ ok: true }));
