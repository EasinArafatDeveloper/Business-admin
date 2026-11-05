# ScaleUp WhatsApp service (Baileys). Internal only — no public port.
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production PORT=4100 WA_AUTH_DIR=/data/auth
RUN mkdir -p /data/auth && chown -R node:node /data /app
USER node
EXPOSE 4100
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4100/health >/dev/null || exit 1
CMD ["node", "server.mjs"]
