import { z } from "zod";

export default z.object({
    health: z.object({
        ok: z.boolean(),
    }).strict(),
}).strict();