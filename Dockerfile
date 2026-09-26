# Stage 1: the Angular app (needs Node 22+)
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the server
FROM node:22-alpine AS server
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm test && npm prune --omit=dev

# Stage 3: runtime — one process serves the API, the web app, and runs the poll loop
FROM node:22-alpine
WORKDIR /app
COPY --from=server /app/node_modules ./node_modules
COPY --from=server /app/dist ./dist
COPY --from=server /app/package.json ./
COPY --from=web /web/dist/web/browser ./web/dist/web/browser
# Persistent volume: Google token, state, glossary, thread cache.
# Coolify: add /data as a volume in the UI (beta.460 has no storage API).
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
