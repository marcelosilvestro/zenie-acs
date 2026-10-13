import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em desenvolvimento, /api vai para o zenie-api (ex.: túnel SSH para a VM: ZENIE_API=http://localhost:8080).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": process.env.ZENIE_API ?? "http://localhost:8080" } },
});
