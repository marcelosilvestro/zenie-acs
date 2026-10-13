#!/bin/sh
# Gera certificado autoassinado na primeira subida, se não houver certificado no volume.
# Para usar certificado próprio/Let's Encrypt: coloque fullchain.pem e privkey.pem em /etc/zenie/tls.
set -eu
DIR=/etc/zenie/tls
HOST="${ZENIE_PUBLIC_HOST:-localhost}"
mkdir -p "$DIR"
if [ ! -s "$DIR/fullchain.pem" ] || [ ! -s "$DIR/privkey.pem" ]; then
  if echo "$HOST" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then SAN="IP:$HOST"; else SAN="DNS:$HOST"; fi
  echo "zenie: gerando certificado autoassinado para $HOST ($SAN)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
    -subj "/CN=$HOST/O=Zenie" -addext "subjectAltName=$SAN,DNS:localhost" >/dev/null 2>&1
  chmod 600 "$DIR/privkey.pem"
fi
