# Zenie web — build da SPA (React/Vite) e nginx com HTTPS servindo o app e repassando /api.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.28-alpine
RUN apk add --no-cache openssl
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/10-zenie-tls.sh /docker-entrypoint.d/10-zenie-tls.sh
RUN chmod +x /docker-entrypoint.d/10-zenie-tls.sh && rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
