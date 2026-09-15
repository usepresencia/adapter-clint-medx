FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
# prisma.config.ts exige DATABASE_URL resolvível para o CLI (mesmo que "generate"
# não conecte de fato) — usa um valor fictício só para o build.
ARG DATABASE_URL="postgresql://user:password@localhost:5432/adapter"
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/main.js"]
