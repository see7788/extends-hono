import { Hono } from "hono";
import path from "path"
// import store from "../../store"
// import zod from "./zod"
// 可以消费主store，不允许直接消费切片store，也限制跨切片消费；当然，允许无store
// 如果方法很多或者有生命周期，切片内起个文件fun.ts|class.ts来调用，
export default new Hono()
    .basePath(path.basename(import.meta.dirname))//切片名称===根级路由名称，
    .get("/base", context => context.json({ ok: true }));
