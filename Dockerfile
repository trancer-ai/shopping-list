# -------- Build stage --------
    FROM node:20-alpine AS builder
    WORKDIR /app
    
    # Install deps for server and client
    COPY server/package*.json server/
    COPY client/package*.json client/
    RUN npm --prefix server ci && npm --prefix client ci
    
    # Copy source
    COPY server server
    COPY client client
    
    # Build client and copy into server/public
    RUN npm --prefix client run build \
      && mkdir -p server/public \
      && cp -r client/dist/* server/public/
    
    # -------- Runtime stage --------
    FROM node:20-alpine
    WORKDIR /app
    
    ENV NODE_ENV=production
    ENV PORT=3000
    ENV DB_PATH=/data/app.db
    
    # Copy built server (with public assets)
    COPY --from=builder /app/server /app/server
    
    # Install only production deps for server
    RUN npm --prefix server ci --omit=dev
    
    VOLUME ["/data"]
    EXPOSE 3000
    
    CMD ["node", "server/server.js"]    