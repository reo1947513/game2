import { defineConfig, type Plugin } from "vite";

// DEV RANGE 用アセット（gltf/glb モデル等）を本番ビルドから除外するプラグイン。
// Vite の glob でインポートしたアセットは、参照コードがツリーシェイクされても出力されてしまう。
// そのため generateBundle で確実に取り除く。VITE_DEV_RANGE=true のビルド（専用デプロイ／dev:range）
// でのみ残し、それ以外（本番）では dist から物理的に出力しない。
function excludeDevAssets(): Plugin {
  const keepDev = process.env.VITE_DEV_RANGE === "true";
  return {
    name: "exclude-dev-assets",
    generateBundle(_options, bundle) {
      if (keepDev) return;
      for (const key of Object.keys(bundle)) {
        if (/\.(gltf|glb)$/i.test(key)) delete bundle[key];
      }
    },
  };
}

// Viteの設定。distフォルダにビルド成果物を出力し、
// その成果物をserver.js（Express）が配信してRailwayで動かす想定です。
export default defineConfig({
  plugins: [excludeDevAssets()],
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
