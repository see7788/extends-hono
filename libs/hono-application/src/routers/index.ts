import base from "./base";
import { Hono } from "hono";
// 此文件只负责原样组合。
export default new Hono()
.route("/", base)//原样路由，很多时候消费者使用hono的hc只要用切片的类型