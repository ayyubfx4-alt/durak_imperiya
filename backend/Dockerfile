# =============================================================================
# backend/Dockerfile — Multi-stage production build
#
# Stages:
#   deps        — install production dependencies (cached layer)
#   production  — final lean image (~120 MB vs ~800 MB full)
#
# Usage (standalone):
#   docker build --target production -t durak-backend:latest .
#
# Used by docker-compose.prod.yml automatically.
# =============================================================================

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only manifest files to leverage Docker layer cache.
# node_modules won't be reinstalled unless package*.json changes.
COPY package*.json ./

# Install production deps only — no devDependencies in the final image.
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security hardening: run as non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S durak -u 1001 -G nodejs

WORKDIR /app

# Copy pre-built dependencies from deps stage.
COPY --from=deps --chown=durak:nodejs /app/node_modules ./node_modules

# Copy application source.
COPY --chown=durak:nodejs . .

# Create log directory (PM2 / file logger).
RUN mkdir -p logs && chown durak:nodejs logs

# Drop to non-root user.
USER durak

EXPOSE 4000

# Health check — Docker marks container unhealthy if /health returns non-200.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health | grep -q '"status":"ok"' || exit 1

# Use node directly (not npm) for faster startup and proper signal handling.
CMD ["node", "src/index.js"]
