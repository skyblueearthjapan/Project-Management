# --- build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# --- runtime stage ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
