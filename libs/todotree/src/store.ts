import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import todotree, { type TodoTreeStore } from "./todotree/store.ts";

const store = create<TodoTreeStore>()(immer(todotree));

export default store;
