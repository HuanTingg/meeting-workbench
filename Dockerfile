FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY app ./app
COPY modules ./modules
COPY shared ./shared
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production MEETING_DATA_DIR=/app/data MEETING_BIND_HOST=0.0.0.0 PORT=8765
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir data && chown node:node data
COPY --from=build /app/app ./app
COPY --from=build /app/public ./public
COPY scripts/docker-entry.mjs ./scripts/docker-entry.mjs
USER node
EXPOSE 8765
CMD ["node", "scripts/docker-entry.mjs"]
