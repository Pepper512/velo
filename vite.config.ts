import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // PR D REQ-1.4: the browser floor stays Vite 7's Baseline set, so the
    // emitted syntax and CSS do not change with the bundler. Lifting it to
    // Vite 8's default (Chrome 111, Safari 16.4) is a separate decision that
    // needs the minimum webview named per platform.
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    cssTarget: ["chrome107", "edge107", "firefox104", "safari16"],
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        splashscreen: path.resolve(__dirname, "splashscreen.html"),
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
