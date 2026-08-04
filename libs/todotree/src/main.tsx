import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./routers.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("TodoTree root element does not exist.");

createRoot(root).render(<RouterProvider router={router} />);
