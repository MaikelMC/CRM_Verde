import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { outDir: "dist" },
  plugins: [
    VitePWA({
      registerType: "prompt", // sin skipWaiting automático: la UI decide
      manifest: {
        name: "La Verde Gestión",
        short_name: "Gestión",
        lang: "es",
        start_url: "/",
        display: "standalone",
        background_color: "#0b3d2e",
        theme_color: "#0b3d2e",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache del build. Sin runtimeCaching: la app lee de Dexie, no de /api.
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
