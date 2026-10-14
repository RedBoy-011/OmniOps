import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./styles.css";

// Register Service Worker for Universal PWA
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[OmniOps PWA] Service Worker registered:", reg.scope);
      })
      .catch((err) => {
        console.warn("[OmniOps PWA] Service Worker registration failed:", err);
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
