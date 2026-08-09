FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/lib ./lib
COPY --chown=node:node openapi.yaml ./openapi.yaml
EXPOSE 8080
CMD ["node","lib/src/server.js"]
