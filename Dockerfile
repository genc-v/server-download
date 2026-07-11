FROM node:20-slim

# Append non-free to every Components line in the DEB822 sources file.
RUN sed -i '/^Components:/ s/$/ contrib non-free non-free-firmware/' \
      /etc/apt/sources.list.d/debian.sources

# Install extraction tools:
#   unrar            → real unrar (non-free): handles all RAR3/RAR4/RAR5 methods
#   p7zip-full       → 7z: zip, 7z, tar.* and fallback for rar
#   unzip            → zip fallback
#   libarchive-tools → bsdtar: universal fallback
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      unrar \
      p7zip-full \
      unzip \
      libarchive-tools \
    && rm -rf /var/lib/apt/lists/* \
    && which unrar && unrar --version | head -1

WORKDIR /app

COPY package.json ./
COPY server.js    ./
COPY src/         ./src/
COPY public/      ./public/
COPY source.json  ./

ENV PORT=3939
ENV DOWNLOADS_DIR=/data/downloads

VOLUME ["/data"]

EXPOSE 3939

CMD ["node", "server.js"]
