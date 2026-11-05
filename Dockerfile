FROM node:22-alpine

WORKDIR /app

# empire-api (WebSocket bridge, no Chrome)
COPY apps/empire-api/package.json apps/empire-api/package-lock.json ./apps/empire-api/
RUN cd apps/empire-api && npm ci --omit=dev --no-audit --no-fund
COPY apps/empire-api ./apps/empire-api

# collector (storm + dungeons -> Supabase)
COPY apps/collector/package.json apps/collector/package-lock.json ./apps/collector/
RUN cd apps/collector && npm ci --no-audit --no-fund
COPY apps/collector ./apps/collector
RUN cd apps/collector && npm run build && npm prune --omit=dev

COPY scripts/start.sh ./scripts/start.sh

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "/app/scripts/start.sh"]
