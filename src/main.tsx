import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FinanceApp from "./FinanceApp";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FinanceApp />
  </StrictMode>,
);
