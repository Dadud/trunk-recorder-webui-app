FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY app ./app
COPY config ./config
COPY data ./data
COPY public ./public
COPY web ./web
EXPOSE 8080
ENV PORT=8080
CMD ["npm", "start"]
