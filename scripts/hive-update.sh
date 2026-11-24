#!/bin/bash
# Hive modification: back up, then apply the new checkout. Roll back with hive-restore.sh.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
bash scripts/hive-backup.sh
docker compose --env-file .env -f infra/compose/docker-compose.yml up -d --build
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null; then
    echo "Update is up"
    exit 0
  fi
  sleep 2
done
echo "Update did not become healthy. Restore the backup directory." >&2
exit 1
