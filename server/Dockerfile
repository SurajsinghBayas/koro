FROM oven/bun:1.3-alpine
WORKDIR /app
COPY server/package.json server/bun.lock* ./server/
RUN cd server && bun install --production --frozen-lockfile || (cd server && bun install --production)
COPY shared ./shared
COPY server ./server
WORKDIR /app/server
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["bun", "src/index.ts"]
