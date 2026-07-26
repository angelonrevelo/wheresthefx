import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 5173,
    // Same-origin in development too, so `/api/...` behaves here exactly
    // as it does in production, where one process serves both. Without
    // this, dev would need a cross-origin base URL and CORS config that
    // production does not use — two shapes to keep working instead of one.
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@wheresthefx/core": path.resolve(__dirname, "../../package/core/src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          map: ["leaflet"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
