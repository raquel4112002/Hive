#!/bin/bash
# Hive modification: restore a backup made by hive-backup.sh onto this host.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
src=${1:-}
if [ -z "$src" ] || [ ! -f "$src/postgres.dump" ] || [ ! -f "$src/env.enc" ]; then
  echo "Pass the backup directory" >&2
  exit 1
fi
if [ -z "${HIVE_BACKUP_PASSPHRASE:-}" ]; then
  echo "Set HIVE_BACKUP_PASSPHRASE" >&2
  exit 1
fi
openssl enc -d -aes-256-cbc -pbkdf2 -in "$src/env.enc" -out .env -pass env:HIVE_BACKUP_PASSPHRASE
docker compose --env-file .env -f infra/compose/docker-compose.yml up -d postgres
for _ in $(seq 1 60); do
  if docker exec hive-postgres-1 pg_isready -U rakazo >/dev/null; then
    break
  fi
  sleep 2
done
docker cp "$src/postgres.dump" hive-postgres-1:/tmp/hive.dump
docker exec hive-postgres-1 pg_restore -U rakazo -d rakazo --clean --if-exists /tmp/hive.dump
docker exec hive-postgres-1 rm -f /tmp/hive.dump
for volume in hive_minio hive_openbao; do
  if [ -f "$src/${volume}.tar" ]; then
    docker volume create "$volume" >/dev/null
    docker run --rm -v "$volume":/to -v "$src":/from alpine tar -C /to -xf "/from/${volume}.tar"
  fi
done
if [ -f "$src/data.tar" ]; then
  mkdir -p data
  tar -C data -xf "$src/data.tar"
fi
docker compose --env-file .env -f infra/compose/docker-compose.yml up -d
echo "Restore started"
