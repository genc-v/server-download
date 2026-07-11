FROM node:20-slim

# Install extraction tools:
#   p7zip-full       → 7z (handles zip, 7z, rar incl. RAR5, tar.*)
#   unrar-free       → additional rar fallback (main repo)
#   unzip            → fallback for zip
#   libarchive-tools → bsdtar (universal fallback)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      p7zip-full \
      unrar-free \
      unzip \
      libarchive-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY server.js    ./
COPY src/         ./src/
COPY public/      ./public/

# source.json is the game catalogue — mount it as a volume if you want
# to swap it without rebuilding; copy it here as a default.
COPY source.json  ./

ENV PORT=3939
ENV DOWNLOADS_DIR=/data/downloads

VOLUME ["/data"]

EXPOSE 3939

CMD ["node", "server.js"]
