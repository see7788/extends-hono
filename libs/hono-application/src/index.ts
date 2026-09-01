import { honoServer } from "vite-config-lib/hono";
import routers from "./routers";

export default honoServer(routers);
