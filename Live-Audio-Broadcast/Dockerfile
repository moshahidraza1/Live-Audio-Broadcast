FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY drizzle ./drizzle
COPY livekit.yaml ./livekit.yaml

ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "./src/server.js"]
