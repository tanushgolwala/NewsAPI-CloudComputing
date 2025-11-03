# Build stage
FROM golang:1.24-alpine AS builder
WORKDIR /app

# Install CA certs in the builder too (handy for go mod over HTTPS)
RUN apk add --no-cache ca-certificates && update-ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Run stage (distroless includes CA certs)
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /
COPY --from=builder /app/main /main

# Run as non-root (good practice on Cloud Run)
USER nonroot:nonroot


ENTRYPOINT ["/main"]
