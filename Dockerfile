FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DURABL_DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 9080
CMD ["node", "--enable-source-maps", "dist/service.js"]
