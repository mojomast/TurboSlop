# ---------------------------------------------------------------------------
# TurboSlop
#
# Multi-stage, but deliberately simple: the app is run with tsx rather than
# compiled, because it is a tool (not a library) and staying unbuilt keeps the
# container honest about what is actually executing.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# devDependencies are required at runtime here: tsx IS the runtime.
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    FORGE_PORT=4400 \
    FORGE_OUT_DIR=/data/out

# Run unprivileged.
RUN addgroup -S slop && adduser -S slop -G slop && mkdir -p /data/out && chown -R slop:slop /data

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY docs ./docs
COPY README.md ./

USER slop
EXPOSE 4400

# Keep generated designs and artwork on a volume so they survive redeploys.
VOLUME ["/data/out"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FORGE_PORT||4400)+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/server.ts"]
