# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

# Keep the package-manager version and the workspace dependency graph reproducible.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY deploy ./deploy
COPY demo ./demo
RUN corepack enable \
  && corepack prepare pnpm@11.24.0 --activate \
  && pnpm install --frozen-lockfile --prod \
  && pnpm --dir apps/web test

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0 \
    DATA_ROOT=/var/lib/code-atlas \
    NODE_OPTIONS=--experimental-strip-types

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/apps/api /app/apps/web /app/packages /app/deploy "$DATA_ROOT" \
  && chown node:node "$DATA_ROOT"

COPY --from=build /app/apps/api /app/apps/api
COPY --from=build /app/apps/web/index.html /app/apps/web/index.html
COPY --from=build /app/apps/web/admin.html /app/apps/web/admin.html
COPY --from=build /app/apps/web/styles.css /app/apps/web/styles.css
COPY --from=build /app/apps/web/src /app/apps/web/src
COPY --from=build /app/packages /app/packages
COPY --from=build /app/node_modules /app/node_modules
RUN mkdir -p /app/node_modules/@code-knowledge-assistant \
  && for package in access-control analysis answering demo-review evaluation git-intake intake model-provider observability provider-budget retrieval review-artifacts review-generation review-jobs review-orchestration review-pipeline review-service source-snapshots; do \
       ln -s "/app/packages/$package" "/app/node_modules/@code-knowledge-assistant/$package"; \
     done
COPY --from=build /app/deploy/start.mjs /app/deploy/start.mjs
COPY --from=build /app/demo /app/demo

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "deploy/start.mjs"]
