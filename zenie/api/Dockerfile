# Zenie API — build TypeScript e imagem de execução enxuta (sem devDependencies).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# Saídas reais da OLT de referência: modo "Simulada" do cadastro de OLT (src/olt/simulated.ts).
COPY fixtures ./fixtures
# Lista de fabricantes (OUI/IEEE); falha de rede não quebra o build.
RUN node scripts/fetch-oui.mjs && mkdir -p data
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
COPY --from=build /app/fixtures ./fixtures
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
