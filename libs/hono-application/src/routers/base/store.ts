import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import zod from "./zod"
import { z } from "zod";
//只允许跨切片消费验证器类型
export default ((..._options) => ({
  base: { health: { ok: true } },
  baseAction: {}
})) satisfies ImmerStateCreator< {
  base: z.output<typeof zod>;
  baseAction: {}
}>;