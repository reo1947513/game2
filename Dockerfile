# ARENA STRIKE クライアント（Vite ビルド → Express で dist を配信）。
# Nixpacks の自動生成を使わず、このDockerfileでビルドを完全に制御する。
# VITE_WS_URL はビルド時に焼き込む必要があるため、ARG で受けて build 前に ENV へ反映する。
FROM node:20-alpine

WORKDIR /app

# 依存のインストール（lockfile があるので npm ci）
COPY package.json package-lock.json ./
RUN npm ci

# ソース一式
COPY . .

# 共有型サブモジュール（src/shared）は Railway のビルド文脈に展開されない場合があり、
# その際 src/shared/protocol.ts が欠落して tsc が全 online 系の型解決に失敗する。
# protocol.ts が無いときだけ、公開リポジトリから superproject が固定しているコミットを
# 取得して配置する（既に存在する場合は何もしないので、ローカルや正常時は無影響）。
RUN if [ ! -f src/shared/protocol.ts ]; then \
      apk add --no-cache git && \
      rm -rf src/shared && \
      git clone https://github.com/reo1947513/game2-shared.git src/shared && \
      git -C src/shared checkout 96b69dd051b4dafc770fee4029f4ff6f1aa24fa2; \
    fi

# WebSocketサーバーのURL。Railway が build-arg を渡せば上書きされるが、渡されない場合に
# 備えて本番サーバーURLを既定値にしておく（これで確実にバンドルへ焼き込まれる）。
# Vite は import.meta.env.VITE_WS_URL をビルド時に読むので、build より前に ENV へ置く。
ARG VITE_WS_URL=wss://game2-server-production.up.railway.app
ENV VITE_WS_URL=$VITE_WS_URL

# tsc --noEmit && vite build → dist/
RUN npm run build

ENV NODE_ENV=production

# Railway が注入する PORT を server.js が読む（既定3000）。
EXPOSE 3000

CMD ["node", "server.js"]
