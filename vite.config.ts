import { defineConfig } from "vite";

// Viteの設定。distフォルダにビルド成果物を出力し、
// その成果物をserver.js（Express）が配信してRailwayで動かす想定です。
export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
});
