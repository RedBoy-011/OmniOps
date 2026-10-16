import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./styles.css";

// PWA disabled as requested: Unregister any legacy Service Worker
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  }).catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
