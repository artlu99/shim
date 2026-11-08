#!/usr/bin/env bash
# Idempotent Debian host prep for shim. Run as root:
#   sudo bash install.sh
# Does not write real secrets, start Compose, or install cloudflared.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "run as root: sudo bash install.sh" >&2
	exit 1
fi

if [ ! -r /etc/os-release ]; then
	echo "missing /etc/os-release; install.sh supports Debian only" >&2
	exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != "debian" ]; then
	echo "install.sh supports Debian only (found ID=${ID:-unknown})" >&2
	exit 1
fi
if [ -z "${VERSION_CODENAME:-}" ]; then
	echo "VERSION_CODENAME is empty in /etc/os-release" >&2
	exit 1
fi

# 1. Swap. The cushion is for OOM, not throughput.
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

# 2. git, then Docker Engine + Compose plugin when `docker compose` is absent.
apt-get update
apt-get install -y ca-certificates curl git
if ! docker compose version >/dev/null 2>&1; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
	apt-get update
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	echo "docker installed"
else
	echo "docker compose already present, skipping"
fi
docker compose version

# 3. Docker group for the invoking user. Membership applies to a new login.
INVOKER="${SUDO_USER:-}"
if [ -z "$INVOKER" ] || [ "$INVOKER" = "root" ]; then
	echo "NOTE: no non-root SUDO_USER — docker group and /opt chown skipped"
	INVOKER="root"
elif ! id -nG "$INVOKER" | grep -qw docker; then
	usermod -aG docker "$INVOKER"
	echo "NOTE: added $INVOKER to the docker group — LOG OUT AND BACK IN"
	echo "      (or run 'newgrp docker') before any docker compose command"
fi

# 4. Sibling checkouts. Compose builds lmdis from ../lmdis.
if [ -e /opt/shim ] && [ ! -d /opt/shim/.git ]; then
	echo "/opt/shim exists and is not a git checkout" >&2
	exit 1
fi
if [ -e /opt/lmdis ] && [ ! -d /opt/lmdis/.git ]; then
	echo "/opt/lmdis exists and is not a git checkout" >&2
	exit 1
fi
if [ ! -d /opt/shim/.git ]; then
	git clone https://github.com/artlu99/shim /opt/shim
fi
if [ ! -d /opt/lmdis/.git ]; then
	git clone https://github.com/artlu99/lmdis /opt/lmdis
fi

if [ -n "$(git -C /opt/shim status --porcelain)" ]; then
	echo "NOTE: /opt/shim has uncommitted changes — leaving the branch as-is"
else
	git -C /opt/shim fetch origin
	git -C /opt/shim checkout main
	git -C /opt/shim pull --ff-only origin main
fi

# 5. Own the trees, then stage .env. A root-owned checkout breaks later pulls.
if [ "$INVOKER" != "root" ]; then
	chown -R "$INVOKER":"$INVOKER" /opt/shim /opt/lmdis
fi
if [ ! -f /opt/shim/.env ]; then
	cp /opt/shim/.env.example /opt/shim/.env
	chmod 600 /opt/shim/.env
	if [ "$INVOKER" != "root" ]; then
		chown "$INVOKER":"$INVOKER" /opt/shim/.env
	fi
	echo "staged /opt/shim/.env from .env.example — fill CHANGE_ME before compose up"
else
	echo "/opt/shim/.env already exists, leaving it"
fi

echo "Next, as ${INVOKER}:"
echo "  edit /opt/shim/.env (LMDIS_REST_TOKEN and UPSTASH_REDIS_REST_TOKEN must match)"
echo "  cd /opt/shim"
echo "  SHIM_GIT_SHA=\$(git rev-parse --short HEAD) docker compose up -d --build"
echo "  curl -s localhost:7300/health"
echo "  curl -s localhost:7300/info"
if [ "$INVOKER" != "root" ]; then
	echo "If you were just added to the docker group: re-login first (or: newgrp docker)."
fi
