import { z } from "zod";
//只定义zod的验证器
export default z.object({
    health: z.object({
        ok: z.boolean(),
    }).strict(),
}).strict();