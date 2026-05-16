FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV LIBP2P_FORCE_PNET=0

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY config/config.json ./config/config.json

EXPOSE 3000 4001

VOLUME ["/app/data/orbitdb", "/app/data/ipfs", "/app/config"]

CMD ["node", "dist/index.js"]
