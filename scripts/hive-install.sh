#!/bin/bash
# Hive modification: prepare a Linux host and start the stack.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
profiles=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profiles+=("$2"); shift 2 ;;
    *) echo "Unknown argument" >&2; exit 1 ;;
  esac
done
if ! command -v docker >/dev/null; then
  echo "Docker is required" >&2
  exit 1
fi
docker compose version >/dev/null
if [ ! -f .env ]; then
  cp .env.example .env
fi
set_secret() {
  local key="$1"
  local bytes="$2"
  if grep -Eq "^${key}=.+" .env; then
    return
  fi
  local value
  value=$(openssl rand -hex "$bytes")
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
set_secret POSTGRES_PASSWORD 16
set_secret POSTGRES_APP_PASSWORD 16
set_secret BETTER_AUTH_SECRET 32
set_secret ENCRYPTION_KEY 32
set_secret SCREEN_PROXY_SECRET 32
set_secret SANDBOX_SUPERVISOR_TOKEN 32
set_secret HIVE_BACKUP_PASSPHRASE 32
for profile in "${profiles[@]}"; do
  case "$profile" in
    litellm|vault|knowledge|sso|edge) ;;
    *) echo "Unknown profile" >&2; exit 1 ;;
  esac
done
if printf '%s\n' "${profiles[@]}" | grep -qx sso; then
  set_secret KEYCLOAK_ADMIN_PASSWORD 16
  set_secret OIDC_CLIENT_SECRET 16
  set_secret KEYCLOAK_USER_PASSWORD 16
  grep -q '^OIDC_ISSUER=' .env || echo 'OIDC_ISSUER=http://keycloak:8080/realms/hive' >> .env
  grep -q '^OIDC_CLIENT_ID=' .env || echo 'OIDC_CLIENT_ID=hive' >> .env
  grep -q '^OIDC_ALLOW_INSECURE=' .env || echo 'OIDC_ALLOW_INSECURE=true' >> .env
  grep -q '^OIDC_ALLOW_SIGNUP_BYPASS=' .env || echo 'OIDC_ALLOW_SIGNUP_BYPASS=true' >> .env
fi
if grep -E '^[[:space:]]*- "(5432|8200|9000|4000):' infra/compose/docker-compose.yml >/dev/null; then
  echo "An internal port is published on every interface" >&2
  exit 1
fi
args=(--env-file .env -f infra/compose/docker-compose.yml)
for profile in "${profiles[@]}"; do
  args+=(--profile "$profile")
done
docker compose "${args[@]}" up -d --build
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null; then
    echo "Hive is up"
    exit 0
  fi
  sleep 2
done
echo "Hive did not become healthy" >&2
exit 1
