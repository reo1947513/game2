import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Railway上で、Viteがビルドしたdistフォルダを配信する軽量サーバーです。
// 将来オンライン対戦を実装する際は、このサーバーにWebSocketを追加していきます。
//
// DEV RANGE 保護付き別デプロイ（案C）：
//   VITE_DEV_RANGE=true でビルドした dist を配信する専用サービスでは、
//   環境変数 DEVRANGE_USER と DEVRANGE_PASS を両方設定すると Basic 認証で全体を保護する。
//   本番デプロイはこれらを設定しないため、従来どおり無認証で配信される（挙動不変）。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distDir = join(__dirname, "dist");

// ヘルスチェックは認証より前に置く（Railway の healthcheck が 401 で落ちないように）。
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// 任意の Basic 認証。DEVRANGE_USER と DEVRANGE_PASS が両方設定されたときだけ有効。
// 未設定（本番デプロイ）では素通りするため、通常配信に影響しない。
function basicAuth(req, res, next) {
  const user = process.env.DEVRANGE_USER;
  const pass = process.env.DEVRANGE_PASS;
  if (!user || !pass) return next(); // 認証無効（本番デプロイ）

  const header = req.headers.authorization || "";
  const sp = header.indexOf(" ");
  const scheme = sp >= 0 ? header.slice(0, sp) : "";
  const encoded = sp >= 0 ? header.slice(sp + 1) : "";
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const u = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const p = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (u === user && p === pass) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="DEV RANGE"');
  res.status(401).send("Authentication required");
}

app.use(basicAuth);

app.use(express.static(distDir));

// どのパスでもindex.htmlを返す（単一ページ構成のため）
app.get("*", (_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`ARENA STRIKE server listening on port ${PORT}`);
});
