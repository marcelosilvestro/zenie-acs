# Imagem única do GenieACS; cada serviço (cwmp, nbi, fs, ui) roda com um
# comando diferente no docker-compose.yml.
# Não existe imagem oficial do GenieACS: instalamos o pacote npm oficial.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim

ARG GENIEACS_VERSION=1.2.16

RUN npm install -g --unsafe-perm "genieacs@${GENIEACS_VERSION}" \
    && npm cache clean --force

RUN useradd --system --home-dir /opt/genieacs --shell /usr/sbin/nologin genieacs \
    && mkdir -p /opt/genieacs/ext \
    && chown -R genieacs:genieacs /opt/genieacs

USER genieacs
WORKDIR /opt/genieacs

ENV GENIEACS_EXT_DIR=/opt/genieacs/ext

# Sem CMD padrão de propósito: o compose define genieacs-cwmp / -nbi / -fs / -ui.
