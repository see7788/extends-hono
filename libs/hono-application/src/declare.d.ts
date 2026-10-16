declare const APP_HEALTH_PATH: "/health";
declare const honoServer: <E extends Env>(hono: Hono<E>) => ServerType
declare const honoUrl:(name: Name)=>URL