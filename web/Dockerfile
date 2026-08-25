FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
ENV VITROFLOW_DATA_ROOT=/data
COPY --from=build /app/dist ./dist
COPY server.ts ./
EXPOSE 3000
CMD ["bun", "server.ts"]
