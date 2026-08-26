FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
ARG HEROUI_KEY
ENV CI=true
ENV HEROUI_KEY=$HEROUI_KEY
RUN test -n "$HEROUI_KEY"
RUN bun install --frozen-lockfile
RUN bunx hpsetup@latest react --auto
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
ENV VITROFLOW_DATA_ROOT=/data
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/node_modules/@heroui-pro/react ./node_modules/@heroui-pro/react
COPY --from=build /app/dist ./dist
COPY server.ts ./
EXPOSE 3000
CMD ["bun", "server.ts"]
