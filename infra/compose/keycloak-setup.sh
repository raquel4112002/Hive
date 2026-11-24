#!/bin/bash
# Hive modification: create the local Keycloak realm. Secrets come from the environment.
set -euo pipefail
if [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ] || [ -z "${OIDC_CLIENT_SECRET:-}" ]; then
  echo "Keycloak setup needs an admin password and a client secret" >&2
  exit 1
fi
ready=0
for _ in $(seq 1 60); do
  if /opt/keycloak/bin/kcadm.sh config credentials \
    --server "$KC_URL" --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "Keycloak did not become ready" >&2
  exit 1
fi
/opt/keycloak/bin/kcadm.sh create realms -s realm=hive -s enabled=true >/dev/null 2>&1 || true
/opt/keycloak/bin/kcadm.sh create clients -r hive \
  -s clientId=hive \
  -s enabled=true \
  -s protocol=openid-connect \
  -s publicClient=false \
  -s secret="$OIDC_CLIENT_SECRET" \
  -s 'redirectUris=["http://127.0.0.1:5173/api/auth/callback/oidc","http://localhost:5173/api/auth/callback/oidc"]' \
  -s standardFlowEnabled=true >/dev/null 2>&1 || true
/opt/keycloak/bin/kcadm.sh create groups -r hive -s name=owners >/dev/null 2>&1 || true
/opt/keycloak/bin/kcadm.sh update authentication/required-actions/VERIFY_PROFILE -r hive -s enabled=false -s defaultAction=false >/dev/null
/opt/keycloak/bin/kcadm.sh update authentication/required-actions/UPDATE_PASSWORD -r hive -s defaultAction=false >/dev/null
client=$(/opt/keycloak/bin/kcadm.sh get clients -r hive -q clientId=hive --fields id --format csv --noquotes | tail -n 1)
if [ -n "$client" ]; then
  /opt/keycloak/bin/kcadm.sh create "clients/${client}/protocol-mappers/models" -r hive \
    -s name=groups \
    -s protocol=openid-connect \
    -s protocolMapper=oidc-group-membership-mapper \
    -s 'config."claim.name"=groups' \
    -s 'config."full.path"=false' \
    -s 'config."id.token.claim"=true' \
    -s 'config."access.token.claim"=true' \
    -s 'config."userinfo.token.claim"=true' >/dev/null 2>&1 || true
fi
if [ -n "${KEYCLOAK_USER_PASSWORD:-}" ]; then
  /opt/keycloak/bin/kcadm.sh create users -r hive \
    -s username=hive \
    -s email=hive@example.test \
    -s emailVerified=true \
    -s enabled=true >/dev/null 2>&1 || true
  /opt/keycloak/bin/kcadm.sh set-password -r hive --username hive --new-password "$KEYCLOAK_USER_PASSWORD" >/dev/null
  user=$(/opt/keycloak/bin/kcadm.sh get users -r hive -q username=hive --fields id --format csv --noquotes | tail -n 1)
  if [ -n "$user" ]; then
    /opt/keycloak/bin/kcadm.sh update "users/${user}" -r hive \
      -s firstName=Hive -s lastName=User -s emailVerified=true -s 'requiredActions=[]' >/dev/null
  fi
  group=$(/opt/keycloak/bin/kcadm.sh get groups -r hive -q search=owners --fields id --format csv --noquotes | tail -n 1)
  if [ -n "$user" ] && [ -n "$group" ]; then
    /opt/keycloak/bin/kcadm.sh update "users/${user}/groups/${group}" -r hive \
      -s realm=hive -s userId="$user" -s groupId="$group" -n >/dev/null
  fi
fi
echo "Keycloak realm is ready"
