import { honoServer } from "hono-vite-config/hono";
import routers from "./routers";

export default honoServer(routers);
