import { z } from "zod";
//只定义zod的验证器,采用**_zod命名
//雷同验证器应该多用zod提供的验证器体操
//严禁export type z.infer
export const test_zod = z.object({
    health: z.object({
        ok: z.boolean(),
    }).strict(),
}).strict();