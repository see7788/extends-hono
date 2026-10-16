import base from "./base";
import { Hono } from "hono";
// 此文件只负责组合。
export default new Hono().route("/",base);
