import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Development server: proxy all /api requests to the local Express backend.
  // This means you never need CORS headers during development.
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      }
    }
  },

  // Production build output — Express serves files from dist/.
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});