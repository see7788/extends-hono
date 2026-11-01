import hono from "./declare/hono";
import routers from "./routers";

export default hono.honoServer(routers);
