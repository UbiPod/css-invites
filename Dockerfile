# Stock Community Solid Server 7.3 with css-invites.
# Build stage: install and compile with Bun.
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json .componentsignore ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# Runtime stage: plain Node, as CSS expects.
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json invites-file.json ./
COPY config ./config
COPY templates ./templates
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
ENV CSS_CONFIG=/app/invites-file.json \
    CSS_ROOT_FILE_PATH=/data \
    CSS_PORT=3000
EXPOSE 3000
ENTRYPOINT ["node", "node_modules/@solid/community-server/bin/server.js", "-m", "/app"]
