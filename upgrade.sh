#!/usr/bin/env bash
# Deploy the shim checkout. Safe to re-run. Does not pull ~/lmdis.
#   bash upgrade.sh
# Fast-forwards this directory to origin/main when the tree is clean.
# A dirty tree exits and leaves the stack alone.
# Skips the image build when the running app's SHIM_GIT_SHA is already HEAD.
# That path still runs `docker compose up -d`, so a changed .env or compose
# file is applied. Any other case rebuilds with SHIM_GIT_SHA set from HEAD.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

if [ -n "$(git status --porcelain)" ]; then
	echo "NOTE: $(pwd) has uncommitted changes — not upgrading" >&2
	exit 1
fi

git fetch origin
git checkout main
git pull --ff-only origin main

sha=$(git rev-parse --short HEAD)
running=$(docker compose exec -T app printenv SHIM_GIT_SHA 2>/dev/null || true)
if [ "$running" = "$sha" ]; then
	echo "already running $sha"
	docker compose up -d
	exit 0
fi

SHIM_GIT_SHA=$sha docker compose up -d --build
