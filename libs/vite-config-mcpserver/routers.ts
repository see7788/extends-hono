import { Hono } from "hono";
import convention from "./convention/index";
import pkg from "./package.json";

export default new Hono().route(
  "/",
  convention.packageNameSet(pkg.name),
);
