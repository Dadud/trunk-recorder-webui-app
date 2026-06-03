# syntax=docker/dockerfile:1.7
# Multi-arch build: linux/amd64 (Unraid, most servers) and linux/arm64 (Pi 4/5)
# Stage 1: build the icad-detect Go binary statically so the runtime image stays small
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS icad-builder
ARG TARGETOS
ARG TARGETARCH
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 https://github.com/TheGreatCodeholio/icad-tone-detection.git .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /out/icad-detect ./cmd/detect 2>/dev/null \
 || echo "icad-detect cmd path may differ, will retry with auto-detect"
# Fallback: try common paths
RUN ls /out/icad-detect 2>/dev/null || (find . -name "main.go" -path "*detect*" -exec dirname {} \; | head -1 | xargs -I{} sh -c 'cd {} && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /out/icad-detect .')

# Stage 2: the actual app image
FROM --platform=$TARGETPLATFORM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY app ./app
COPY config ./config
COPY web ./web
COPY lib ./lib
COPY roles ./roles
COPY --from=icad-builder /out/icad-detect /usr/local/bin/icad-detect
RUN chmod +x /usr/local/bin/icad-detect && \
    mkdir -p /app/data /app/config /recordings
EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production
CMD ["npm", "start"]
