#!/usr/bin/env bash
# Install or update the deployment files on the production LXC. Idempotent.
#
#   git clone https://github.com/Svansig/aetna-take-home.git /root/aetna-take-home
#   sudo /root/aetna-take-home/deploy/install.sh
#
# Installs: /opt/aetna (compose files, smoke test, bin/), /etc/aetna/aetna.env
# (only if absent), systemd units, and the internal Docker network. It never
# touches datasets, the tunnel token, or running containers, and it doesn't
# enable the timers; docs/DEPLOYMENT.md describes the remaining steps.
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

missing=()
for cmd in docker curl jq sqlite3 flock sha256sum timeout; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
docker compose version >/dev/null 2>&1 || missing+=("docker-compose-plugin")
if ((${#missing[@]})); then
  echo "missing prerequisites: ${missing[*]} (see docs/DEPLOYMENT.md, step 2)" >&2
  exit 1
fi

install -d -m 0755 /opt/aetna /opt/aetna/bin /etc/aetna /srv/aetna/data/v1
install -d -m 0700 /var/lib/aetna
install -m 0644 "$src/compose.production.yaml" "$src/compose.tunnel.yaml" "$src/smoke-test.js" /opt/aetna/
install -m 0755 "$src/bin/aetna-update" "$src/bin/aetna-public-check" /opt/aetna/bin/
ln -sf /opt/aetna/bin/aetna-update /usr/local/bin/aetna-update

if [[ ! -e /etc/aetna/aetna.env ]]; then
  install -m 0644 "$src/aetna.env.example" /etc/aetna/aetna.env
  echo "created /etc/aetna/aetna.env from the example; review it"
fi

install -m 0644 "$src"/systemd/aetna-*.service "$src"/systemd/aetna-*.timer /etc/systemd/system/
systemctl daemon-reload

if ! docker network inspect aetna-origin >/dev/null 2>&1; then
  docker network create --internal aetna-origin >/dev/null
  echo "created internal docker network aetna-origin"
fi

echo "installed. Next: datasets in /srv/aetna/data/v1, tunnel token in /etc/aetna/tunnel-token,"
echo "then: docker compose -f /opt/aetna/compose.tunnel.yaml up -d"
echo "      systemctl enable --now aetna-update.timer aetna-public-check.timer"
