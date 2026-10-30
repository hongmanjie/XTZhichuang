FROM node:22-bookworm-slim AS frontend
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-deps
WORKDIR /build/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates python3 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements-cutout.txt ./server/requirements-cutout.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r ./server/requirements-cutout.txt
COPY --from=server-deps /build/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY server/models ./server/models
COPY --from=frontend /build/client/dist ./client/dist
RUN mkdir -p /app/server/data /app/server/uploads && chown -R node:node /app
ENV NODE_ENV=production PORT=3001 \
    DB_PATH=/app/server/data/yimetai.db UPLOAD_DIR=/app/server/uploads \
    FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe
USER node
EXPOSE 3001
CMD ["node", "server/src/index.js"]
