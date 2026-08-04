import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import todotree, { todotree_t } from "./todotree/store.ts";

const store = create<todotree_t>()(immer(todotree));

export default store;
