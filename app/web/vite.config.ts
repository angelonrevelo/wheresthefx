import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    // Matches CORS_ORIGIN in .env.example. The config previously said 7000
    // while the env files and docs all said 5173, so a fresh clone failed CORS.
    port: 5173,
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
