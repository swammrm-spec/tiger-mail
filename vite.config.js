import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!/node_modules/.test(id)) {
            return;
          }
          if (/node_modules[\\/](xlsx)[\\/]/.test(id)) {
            return "vendor-xlsx";
          }
          if (/node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return "vendor-icons";
          }
          if (/node_modules[\\/]dayjs[\\/]/.test(id)) {
            return "vendor-dayjs";
          }
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": backendTarget,
      "/uploads": backendTarget
    }
  }
});
