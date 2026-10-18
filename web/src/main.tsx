import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App";

const root = document.documentElement;
const travel = ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
addEventListener("pointerdown", () => root.setAttribute("data-pointer", ""), true);
addEventListener(
  "keydown",
  (e) => travel.includes(e.key) && root.removeAttribute("data-pointer"),
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
