import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Railway上で、Viteがビルドしたdistフォルダを配信する軽量サーバーです。
// 将来オンライン対戦を実装する際は、このサーバーにWebSocketを追加していきます。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distDir = join(__dirname, "dist");

app.use(express.static(distDir));

// どのパスでもindex.htmlを返す（単一ページ構成のため）
app.get("*", (_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`ARENA STRIKE server listening on port ${PORT}`);
});
