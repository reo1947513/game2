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
