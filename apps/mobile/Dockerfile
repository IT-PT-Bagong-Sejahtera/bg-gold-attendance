FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile apps/mobile

RUN npm ci --workspace @bg-gold/mobile --include-workspace-root

EXPOSE 8081

CMD ["npm", "--workspace", "@bg-gold/mobile", "run", "start", "--", "--host", "lan", "--port", "8081"]
