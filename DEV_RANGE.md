# DEV RANGE（開発者テストレンジ）

武器・ステージ・テクスチャ・的・カメラ・パフォーマンスを検証するための開発専用ツールです。
**本番ビルドには一切含まれません**（`VITE_DEV_RANGE` が `"true"` のときだけ動的 import で読み込まれ、
未設定のビルドでは分岐ごと静的に除去されます）。

## ローカルで使う

```bash
npm run dev:range        # = VITE_DEV_RANGE=true vite
```

または、リポジトリにコミットされない `.env.development.local`（gitignore 済み）に次を書くと、
`npm run dev` でも常時起動します。

```
VITE_DEV_RANGE=true
```

起動すると通常メニューをスキップし、左上に「🔧 DEV RANGE」バッジ、下部に5タブのパネルが出ます。

- 画面クリックで視点ロック、Esc で解除してパネル編集、数字キー 1〜4 で武器切替
- タブ：WEAPON（パラメータ即時編集・JSONコピー）/ STAGE（切替・ワイヤーフレーム・コライダー表示・照明・マテリアル）/ TARGETS（的配置・ダメージログ）/ CAMERA（FPS・フリー・オービット）/ STATS（FPS・drawcall 等）
- グローバルトグル：HP回復 / 無敵 / 飛行 / 座標表示

## 保護付き別デプロイ（案C）

本番デプロイはクリーン（DevRange 未混入・認証なし）のまま据え置き、**DEV RANGE 専用の Railway サービスを別に立て、
Basic 認証で保護**します。同一リポジトリから、ビルド時フラグと環境変数だけ変えて作ります。

### Railway に専用サービスを追加する手順

1. 同じリポジトリから新しい Railway サービス（例: `arena-strike-devrange`）を作成する。
2. そのサービスの **Build Args** に以下を設定する（ビルド時にバンドルへ焼き込まれる）。
   - `VITE_DEV_RANGE=true`
   - 必要なら `VITE_WS_URL` は本番と同じ値（オンライン機能は DEV RANGE では使わないので任意）
3. そのサービスの **Variables（実行時環境変数）** に Basic 認証のID/パスワードを設定する。
   - `DEVRANGE_USER=任意のID`
   - `DEVRANGE_PASS=十分に長いパスワード`
4. デプロイする。発行された URL を開くとブラウザの認証ダイアログが出て、上記の資格情報で入れる。

### 仕組み

- `Dockerfile`：`ARG VITE_DEV_RANGE`（既定は空）→ `ENV` にしてから `npm run build`。本番サービスは未指定なので空＝クリーン。
- `server.js`：`DEVRANGE_USER` と `DEVRANGE_PASS` が**両方**設定されたときだけ Basic 認証を全体に適用。
  本番サービスは未設定なので無認証のまま（挙動不変）。
- `/healthz`：認証より前に 200 を返す専用エンドポイント。Railway のヘルスチェック（`healthcheckPath: /healthz`）が
  認証の 401 で落ちないようにするため。本番でも 200 を返すので無影響。

これにより「本番バンドルから完全に除外」と「ホストされた URL で認証して入る」を両立します。
本番サービスには DEV RANGE のコードもパスワードも存在しません。
