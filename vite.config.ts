import { defineConfig } from "vite";

export default defineConfig({
  // Prevent Vite from pre-bundling the MediaPipe package — it ships its own
  // WASM loader and breaks when processed by esbuild's bundler.
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
  // Multi-page build: both HTML roots are entry points.
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        handRepulsion: "hand-repulsion.html",
      },
    },
  },
});
