import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": "http://127.0.0.1:8100" },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
