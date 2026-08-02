# Monorepo-friendly image for @cortex/data-verse on Railway
FROM node:25-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/viz-contracts ./packages/viz-contracts
COPY apps/data-verse ./apps/data-verse

RUN pnpm install --frozen-lockfile --filter @cortex/data-verse...
RUN pnpm --filter @cortex/viz-contracts build && pnpm --filter @cortex/data-verse build

ENV PORT=5180
EXPOSE 5180
WORKDIR /app/apps/data-verse
CMD ["node", "server.mjs"]
