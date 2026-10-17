# Build context is the repo root: docker build -f api/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
WORKDIR /app/api
COPY --from=build /app/api/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
COPY data /app/data
# Uploaded files and large stored records land here when S3 is not configured (or is unreachable).
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data/uploads
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
