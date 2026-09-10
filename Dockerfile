FROM node:20-bookworm-slim

ARG WGCF_VERSION=2.2.29
ARG WIREPROXY_VERSION=1.0.9
ARG DENO_VERSION=2.2.8

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip ffmpeg curl unzip \
  && pip3 install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
       amd64) wgcf_arch="amd64"; wireproxy_arch="amd64"; deno_arch="x86_64" ;; \
       arm64) wgcf_arch="arm64"; wireproxy_arch="arm64"; deno_arch="aarch64" ;; \
       *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_${wgcf_arch}" -o /usr/local/bin/wgcf \
  && chmod +x /usr/local/bin/wgcf \
  && curl -fsSL "https://github.com/pufferffish/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_${wireproxy_arch}.tar.gz" -o /tmp/wireproxy.tar.gz \
  && tar -xzf /tmp/wireproxy.tar.gz -C /tmp \
  && find /tmp -type f -name wireproxy -exec mv {} /usr/local/bin/wireproxy \; \
  && chmod +x /usr/local/bin/wireproxy \
  && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${deno_arch}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
  && unzip -o /tmp/deno.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/deno \
  && rm -rf /tmp/wireproxy.tar.gz /tmp/deno.zip /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

RUN chmod +x /app/scripts/start.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV WARP_DIR=/tmp/warp
EXPOSE 3000

CMD ["/app/scripts/start.sh"]
