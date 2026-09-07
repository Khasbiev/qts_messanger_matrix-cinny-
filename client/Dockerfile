# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Baked into the JS bundle at build time (Vite has no runtime env) —
# see docker-compose.yml's `client.build.args`, sourced from .env.
ARG VITE_HOMESERVER_URL
ARG VITE_AUTH_GATEWAY_URL
ARG VITE_PUSH_GATEWAY_URL
ARG VITE_PUSH_GATEWAY_NOTIFY_URL
ARG VITE_VAPID_PUBLIC_KEY

RUN npm run build

# ── Serve stage ──────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
