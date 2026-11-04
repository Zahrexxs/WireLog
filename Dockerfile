# syntax=docker/dockerfile:1
FROM node:26-alpine AS runner

# Install wget for container healthcheck
RUN apk add --no-cache tzdata

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy application files
COPY package.json ./
COPY server.js ./
COPY server/ ./server/
COPY client/ ./client/
COPY scripts/ ./scripts/
COPY docs/ ./docs/

# Create persistent data directory and grant permissions to unprivileged node user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
