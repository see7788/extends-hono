import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import zod from "./zod"
import { z } from "zod";
//消费者只有主仓库
const store: ImmerStateCreator<{
  base: z.output<typeof zod>;
  baseAction: {}
}> = () => ({
  base: { health: { ok: true } },
  baseAction: {}
})

export default store