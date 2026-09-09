import mcpserver from "mcpserver";
import viteConfigSlice from "./index";

mcpserver.metas("hono")
  .register(viteConfigSlice)
  .import(["hono", "维护 Hono Vite 项目的配置、依赖和公开导入。"]);
