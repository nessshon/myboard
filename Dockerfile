FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27.2-alpine AS build
ARG TARGETOS TARGETARCH VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -tags no_ui -ldflags "-s -w -X main.Version=${VERSION}" -o /myboard ./cmd

FROM alpine:3.23
LABEL org.opencontainers.image.source="https://github.com/nessshon/myboard" \
      org.opencontainers.image.description="Tasks, board and notes for your team. Sign in with Telegram." \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache ca-certificates
COPY --from=build /myboard /usr/local/bin/myboard
VOLUME ["/myboard_data"]
EXPOSE 8090
ENTRYPOINT ["myboard"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/myboard_data"]
