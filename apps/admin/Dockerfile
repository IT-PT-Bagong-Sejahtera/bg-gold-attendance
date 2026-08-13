FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm install --workspace @bg-gold/admin
COPY apps/admin apps/admin
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm --workspace @bg-gold/admin run build

FROM nginx:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
