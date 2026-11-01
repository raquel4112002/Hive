<!-- Hive modification: Hive install. Derived from Rakazo (Apache License 2.0). -->

# Install Hive

Hive runs from this checkout with Docker Compose. The project name is `hive`. The computer image is `hive/computer:local`. The API, worker, and web app are built from this checkout.

You need Docker Engine 26 or newer with the Compose plugin, and OpenSSL.

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and `POSTGRES_APP_PASSWORD` (`openssl rand -hex 16` each). Set `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` to independent random strings (32 characters or more; 64 hex characters for `ENCRYPTION_KEY`). Set `SANDBOX_SUPERVISOR_TOKEN` to its own random string.
3. Keep those values. Postgres applies the password only when the volume is first created. `docker compose down -v` deletes the database.
4. Start the stack:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up --build
```

5. Open `http://127.0.0.1:5173`.

`RAKAZO_IMAGE` in `.env` names `hive/app`. The checkout Compose file builds the app services itself. Set `RAKAZO_IMAGE` to a registry path only when you pull images instead of building them. The variable names stay `RAKAZO_*`.

More detail on secrets, models, and production TLS is in [docs/self-host.md](../self-host.md) and [docs/self-host-secrets.md](../self-host-secrets.md).
