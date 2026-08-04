import { hc } from "hono/client";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import todotree, {
  validator,
  type TodoTreeStore,
} from "todo-mcp-node/src/todotree/store.ts";
// const store = create<Record<never, never>>()(() => ({}));
const store = create<TodoTreeStore>()(immer(todotree));
// const client = hc<TodoMcpApi>(location.origin);
// const events = new EventSource(client["todo-mcp-node"].events.$url());

// events.addEventListener("tree", event => {
//   store.setState({
//     todotree: validator.tree.parse(JSON.parse(event.data)),
//   });
// });
// events.addEventListener("add", async event => {
//   await store.getState().todotreeActions.add(
//     validator.add.parse(JSON.parse(event.data)),
//   );
// });
// events.addEventListener("set", async event => {
//   await store.getState().todotreeActions.set(
//     validator.set.parse(JSON.parse(event.data)),
//   );
// });

// if (import.meta.hot) import.meta.hot.dispose(() => events.close());

export default store;
