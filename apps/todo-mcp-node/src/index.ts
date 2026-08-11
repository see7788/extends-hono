#!/usr/bin/env tsx
import { honoServer, honoUrl } from "vite-config-lib/hono";
import app from "./routers.ts";

honoServer(app);
console.log(honoUrl("todo-mcp"));
