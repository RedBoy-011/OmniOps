import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: "public-open",
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:9000" },
  },
});
