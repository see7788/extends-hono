import { createHashRouter } from "react-router-dom";
import App from "./todotree/index.tsx";

export default createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: ":nodeId",
        lazy: async () => ({
          Component: (await import("./todotree/Drawer.tsx")).default,
        }),
      },
    ],
  },
]);
