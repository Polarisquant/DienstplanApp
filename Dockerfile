# Optional: eigenen Server / Coolify / Portainer
# Build: docker build -t dienstplan-web .
# Lauf mit externer DB: -e DATABASE_URL -e SESSION_SECRET -e PLANNER_PASSWORD

FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

# DB-Schema anwenden (kleine Installationen); für Migrationen später prisma migrate deploy
CMD ["sh", "-c", "npx prisma db push && npx next start -H 0.0.0.0 -p 3000"]
