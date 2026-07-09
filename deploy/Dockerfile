# syntax=docker/dockerfile:1
#
# Multi-stage build for MSM Accounting Software.
#   build   -> installs deps once, builds the Vite SPA (dist/) and Next.js API (.next)
#   backend -> Next.js API runtime (also carries the Prisma CLI + seed tooling)
#   web     -> Caddy serving the SPA and reverse-proxying /api to the backend
#
# Debian slim (not Alpine) is used on purpose: Prisma, sharp and tesseract.js
# all ship native binaries that fight musl/Alpine.

########################  Build stage (shared)  ########################
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching. `postinstall` runs `prisma generate`,
# so the schema must be present before `npm ci`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Application source (host node_modules/.next/dist are excluded via .dockerignore)
COPY . .

# Frontend config is inlined by Vite AT BUILD TIME. Change SITE_HOST later and
# you must rebuild the `web` image so VITE_API_URL points at the new origin.
ARG VITE_API_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

# Vite SPA -> /app/dist ; Next.js API -> /app/.next
RUN npm run build \
 && npm run backend:build

########################  Backend runtime (Next.js API)  ########################
FROM node:20-slim AS backend
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# Copy the fully-built app, including node_modules. This keeps the Prisma CLI and
# the tsx seed runner available so `docker compose run backend npx prisma db push`
# and `npm run db:seed` work against the running database.
COPY --from=build /app ./

EXPOSE 3000
# `backend:start` runs `prisma generate` then `next start` on :3000.
CMD ["npm", "run", "backend:start"]

########################  Web runtime (Caddy: static SPA + reverse proxy)  ########################
FROM caddy:2 AS web
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
