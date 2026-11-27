import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ["leaflet"],
          charts: ["chart.js"],
          supabase: ["@supabase/supabase-js"]
        }
      }
    }
  }
});
