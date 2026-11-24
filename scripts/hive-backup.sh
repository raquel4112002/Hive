#!/bin/bash
# Hive modification: one backup of the database, files, vault, and encrypted environment.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ -z "${HIVE_BACKUP_PASSPHRASE:-}" ]; then
  echo "Set HIVE_BACKUP_PASSPHRASE" >&2
  exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest=${HIVE_BACKUP_DIR:-"$root/backups"}/$stamp
mkdir -p "$dest"
docker exec hive-postgres-1 pg_dump -U rakazo -d rakazo -Fc -f /tmp/hive.dump
docker cp hive-postgres-1:/tmp/hive.dump "$dest/postgres.dump"
docker exec hive-postgres-1 rm -f /tmp/hive.dump
for volume in hive_minio hive_openbao; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    docker run --rm -v "$volume":/from -v "$dest":/to alpine tar -C /from -cf "/to/${volume}.tar" .
  fi
done
if [ -d data ]; then
  tar -C data -cf "$dest/data.tar" .
fi
openssl enc -aes-256-cbc -pbkdf2 -salt -in .env -out "$dest/env.enc" -pass env:HIVE_BACKUP_PASSPHRASE
keep=${HIVE_BACKUP_KEEP:-14}
find "${HIVE_BACKUP_DIR:-$root/backups}" -mindepth 1 -maxdepth 1 -type d -mtime +"$keep" -exec rm -rf {} +
if [ -n "${HIVE_BACKUP_TARGET:-}" ]; then
  case "$HIVE_BACKUP_TARGET" in
    s3://*) aws s3 sync "$dest" "$HIVE_BACKUP_TARGET/$stamp" ;;
    *) mkdir -p "$HIVE_BACKUP_TARGET"; cp -a "$dest" "$HIVE_BACKUP_TARGET/" ;;
  esac
fi
echo "Backup written"
