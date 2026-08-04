import { createRoot } from "react-dom/client";
import App from "./todotree/index.tsx";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("TodoTree root element does not exist.");

createRoot(root).render(<App />);
