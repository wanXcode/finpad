FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build with API proxy pointing to backend container
ENV NEXT_PUBLIC_API_BASE=""
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
