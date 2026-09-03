import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FinanceApp from "./FinanceApp";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FinanceApp />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app remains usable online if a browser refuses offline caching.
    });
  });
}
