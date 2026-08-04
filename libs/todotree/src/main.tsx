import { ConfigProvider } from "antd";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./routers.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("TodoTree root element does not exist.");

createRoot(root).render(
  <ConfigProvider
    theme={{
      components: {
        Segmented: {
          itemSelectedBg: "#f6ffed",
          itemSelectedColor: "#389e0d",
        },
      },
      token: {
        colorInfo: "#52c41a",
        colorPrimary: "#52c41a",
      },
    }}
  >
    <RouterProvider router={router} />
  </ConfigProvider>,
);
