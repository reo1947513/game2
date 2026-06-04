# ARENA STRIKE — テストステージ（キャラコン＋武器ADSプロトタイプ）

ブラウザで動くオンラインFPSの土台です。今回の段階では、テスト用ステージの中で
キャラクターコントロール（キャラコン）と、武器の覗き込み（ADS）挙動を実際に動かせます。

技術構成は Vite + TypeScript + Three.js、配信は Express（Railway）です。

## ローカルでの起動

```bash
npm install
npm run dev
```

表示されたURL（既定では http://localhost:5173 ）をブラウザで開き、画面をクリックすると始まります。

## 本番ビルドと配信（Railwayと同じ動かし方）

```bash
npm run build   # distフォルダにビルド
npm start       # Expressがdistを配信（PORT環境変数を使用）
```

## 操作方法

- 移動: W A S D
- 視点: マウス（画面クリックでポインタロック）
- ジャンプ: Space（空中でもう一度押すと2段ジャンプ）
- 壁ジャンプ: 壁に触れている状態で空中で Space
- ダッシュ: Shift
- しゃがみ: Ctrl（ダッシュ中に押すとスライディング）
- 伏せ: Z（押すたびに切替）
- 射撃: 左クリック
- 覗き込み(ADS): 右クリック（スナイパーは専用スコープ、アサルトはドットサイト）
- リロード: R
- 武器切替: 1=アサルト / 2=スナイパー
- ポインタ解除: Esc

## 用意済みテクスチャの差し替え方法

現状の武器・的は仮の簡易モデルです。用意済みのテクスチャやモデルは次の場所で適用します。

- 武器モデル: `src/WeaponSystem.ts` の `buildAssault()` / `buildSniper()`。
  簡易ボックスの代わりに `GLTFLoader` で読み込んだモデルを `g.add(...)` してください。
  テクスチャだけを当てる場合は、各 `MeshStandardMaterial` の `map` に
  `new THREE.TextureLoader().load("/textures/xxx.png")` を設定します。
  画像は `public/textures/` に置くと `/textures/...` で参照できます。
- キャラクターモデル: 対戦相手キャラを追加する際に、同様に `public/` 配下へ置いて読み込みます。

## 主要ファイルの役割

- `src/PlayerController.ts` — キャラコンの中身（移動・ジャンプ・壁ジャンプ・スライド・伏せ・当たり判定）
- `src/WeaponSystem.ts` — 武器の表示・ADS・スコープ・射撃・反動・リロード
- `src/Stage.ts` — テストステージ（地面・壁・段差・壁ジャンプ用の壁・的）
- `src/Input.ts` — キーボード・マウス・ポインタロック
- `src/HUD.ts` — 画面表示（クロスヘア・スコープ・弾数・姿勢）
- `src/Game.ts` — 全体の統合と描画ループ
- `server.js` — Railway用の配信サーバー（後でWebSocketを追加）

## 今後（オンライン対戦の追加方針）

`server.js` に WebSocket を追加し、各プレイヤーの位置・向き・射撃を一定間隔で同期します。
1v1〜3v3、3チーム対戦はサーバー側の「部屋（ルーム）」と「チーム割り当て」で表現します。
詳細はチャットの解説を参照してください。
