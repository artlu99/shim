#!/usr/bin/env bash
# One-time VPS prep for shim-SH. Run as root on the target Ubuntu box.
set -euo pipefail

# 1. Swap (box ships with ZERO swap; this is an OOM cushion, not perf)
if [ ! -f /swapfile ]; then
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	sysctl -w vm.swappiness=10
	echo 'vm.swappiness=10' >/etc/sysctl.d/99-shim-swap.conf
	echo "swap enabled"
else
	echo "swapfile already exists, skipping"
fi

# 2. Docker Engine + compose plugin (skip if the box already runs containers)
if ! command -v docker >/dev/null; then
	apt-get update
	apt-get install -y ca-certificates curl
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" >/etc/apt/sources.list.d/docker.list
	apt-get update
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	echo "docker installed"
else
	echo "docker already present, skipping"
fi
docker compose version

# 3. Sibling checkout for the lmdis build context (compose builds ../lmdis)
cd /opt
[ -d shim ] || git clone https://github.com/artlu99/shim shim
[ -d lmdis ] || git clone https://github.com/artlu99/lmdis lmdis
cd /opt/shim && git checkout sh

echo "Next: stage /opt/shim/.env (see .env.sh.example), then: docker compose up -d --build"
