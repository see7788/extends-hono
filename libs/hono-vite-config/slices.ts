import mcpserver from "mcpserver";
import viteConfigSlice from "./index";

mcpserver.metas("hono")
  .metas(viteConfigSlice)
  .import(["hono", "维护 Hono Vite 项目的配置、依赖和公开导入。"]);
