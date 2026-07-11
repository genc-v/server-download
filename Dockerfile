FROM node:20-slim

# Enable non-free repo for the real unrar (full RAR3+RAR5 support)
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' \
      /etc/apt/sources.list.d/debian.sources

# Install extraction tools:
#   unrar            → best RAR support (non-free, handles all methods)
#   p7zip-full       → 7z (zip, 7z, tar.*, fallback for rar)
#   unzip            → zip fallback
#   libarchive-tools → bsdtar (universal fallback)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      unrar \
      p7zip-full \
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
