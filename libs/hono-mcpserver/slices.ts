import mcpserver from "mcpserver";
import viteConfig from "./vite-config/index";

export default mcpserver.packageImport({
  packageName: "hono-mcpserver",
  description: "为 Hono Vite 项目提供依赖、导入与 Vite 配置工具。",
  RegisterAny: [viteConfig],
});
