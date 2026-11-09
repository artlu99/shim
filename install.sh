#!/usr/bin/env bash
# Idempotent shim setup for the deploy user. Do not run as root.
#   bash install.sh
# Expects git, Docker Engine, and the Compose plugin to already be installed.
# A rootless daemon is the preferred path. A rootful one warns and continues.
# Clones to $HOME/shim and $HOME/lmdis. The app binds 127.0.0.1:${SHIM_PORT:-7300}.
#   SHIM_PORT=7301 bash install.sh
# When $HOME/shim/.env is missing, writes one with a random lmdis token.
# Does not print that token, start Compose, or install cloudflared.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
	echo "run install.sh as the deploy user, not root" >&2
	exit 1
fi

if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ] || [ ! -w "$HOME" ]; then
	echo "HOME must be a writable directory" >&2
	exit 1
fi

if ! command -v git >/dev/null 2>&1; then
	echo "git is not installed. install it yourself, then re-run. this script will not use sudo." >&2
	exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
	echo "docker compose is not available. install Docker Engine and the Compose plugin, then re-run." >&2
	exit 1
fi

SHIM_PORT=${SHIM_PORT:-7300}
if [[ ! "$SHIM_PORT" =~ ^[0-9]+$ ]] || [ "$SHIM_PORT" -lt 1 ] || [ "$SHIM_PORT" -gt 65535 ]; then
	echo "SHIM_PORT must be an integer from 1 to 65535" >&2
	exit 1
fi

# SecurityOptions from `docker info` includes name=rootless when the daemon
# this user is talking to is rootless. The docker group is root-equivalent.
# A rootful daemon warns and the install continues. Moving to rootless can
# happen later; the steps are the same ones this script is about to run.
warn_rootful() {
	cat >&2 <<EOF
WARNING: $1
Rootless mode keeps container access off the host root account. Joining the
docker group is root-equivalent. You can move to rootless over time. The
install below is the same either way.
Rootless setup: https://docs.docker.com/engine/security/rootless/
EOF
}

if ! security=$(docker info --format '{{range .SecurityOptions}}{{println .}}{{end}}' 2>/dev/null); then
	warn_rootful "docker info failed, so this session is not using a rootless daemon."
elif ! printf '%s\n' "$security" | grep -q 'rootless'; then
	warn_rootful "docker info does not report rootless mode."
else
	echo "docker is rootless"
fi

shim_dir="${HOME}/shim"
lmdis_dir="${HOME}/lmdis"

# Sibling checkouts. Compose builds lmdis from ../lmdis.
if [ -e "$shim_dir" ] && [ ! -d "$shim_dir/.git" ]; then
	echo "$shim_dir exists and is not a git checkout" >&2
	exit 1
fi
if [ -e "$lmdis_dir" ] && [ ! -d "$lmdis_dir/.git" ]; then
	echo "$lmdis_dir exists and is not a git checkout" >&2
	exit 1
fi
if [ ! -d "$shim_dir/.git" ]; then
	git clone https://github.com/artlu99/shim "$shim_dir"
fi
if [ ! -d "$lmdis_dir/.git" ]; then
	git clone https://github.com/artlu99/lmdis "$lmdis_dir"
fi

if [ -n "$(git -C "$shim_dir" status --porcelain)" ]; then
	echo "NOTE: $shim_dir has uncommitted changes — leaving the branch as-is"
else
	git -C "$shim_dir" fetch origin
	git -C "$shim_dir" checkout main
	git -C "$shim_dir" pull --ff-only origin main
fi

# An existing .env is left alone so a re-run does not rotate the token.
if [ ! -f "$shim_dir/.env" ]; then
	(
		umask 077
		token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
		if [[ ! "$token" =~ ^[0-9a-f]{64}$ ]]; then
			echo "failed to generate lmdis token" >&2
			exit 1
		fi
		cat > "$shim_dir/.env" <<EOF
# written by install.sh. do not commit.
SHIM_PORT=${SHIM_PORT}
UPSTASH_REDIS_REST_URL=http://lmdis:3000
UPSTASH_REDIS_REST_TOKEN=${token}
LMDIS_REST_TOKEN=${token}

# optional bare JSON-RPC root; default is the Base RPC racer
# https://evm.stupidtech.net/v1/8453
# BASE_RPC_URL=

# bare host:port, no scheme. replace when this hub rotates.
HUB_GRPC_ENDPOINT=107.20.169.236:3383
EOF
	)
	chmod 600 "$shim_dir/.env"
	echo "wrote $shim_dir/.env with a new lmdis token (not printed)"
else
	echo "$shim_dir/.env already exists, leaving it"
	echo "edit SHIM_PORT in that file to change the host port"
fi

listen_port=7300
if [ -f "$shim_dir/.env" ]; then
	file_port=$(sed -n 's/^SHIM_PORT=//p' "$shim_dir/.env" | head -n 1)
	if [ -n "$file_port" ]; then
		listen_port=$file_port
	fi
fi

echo "Next:"
echo "  cd $shim_dir"
echo "  SHIM_GIT_SHA=\$(git rev-parse --short HEAD) docker compose up -d --build"
echo "  curl -s localhost:${listen_port}/health"
echo "  curl -s localhost:${listen_port}/info"
