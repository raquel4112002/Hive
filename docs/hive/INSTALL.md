<!-- Hive modification: Hive install. Derived from Rakazo (Apache License 2.0). -->

# Install Hive

Hive runs from this checkout with Docker Compose. The project name is `hive`. The computer image is `hive/computer:local`. The API, worker, and web app are built from this checkout.

You need Docker Engine 26 or newer with the Compose plugin, and OpenSSL.

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and `POSTGRES_APP_PASSWORD` (`openssl rand -hex 16` each). Set `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` to independent random strings (32 characters or more; 64 hex characters for `ENCRYPTION_KEY`). Set `SANDBOX_SUPERVISOR_TOKEN` to its own random string.
3. Keep those values. Postgres applies the password only when the volume is first created. If migrate exits because the database rejects the password, the volume was created with different passwords. `docker compose --env-file .env -f infra/compose/docker-compose.yml down -v` deletes it, and the next start creates a new database.
4. Start the stack:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up --build
```

5. Open `http://127.0.0.1:5173`.
6. Choose Sign up. The first account is the super-admin. The app opens a bot; the message box is how you talk to it.

`RAKAZO_IMAGE` in `.env` names `hive/app`. The checkout Compose file builds the app services itself. Set `RAKAZO_IMAGE` to a registry path only when you pull images instead of building them. The variable names stay `RAKAZO_*`.

## Model

Hive uses one OpenAI-compatible endpoint for the installation. Set all three, or none. A bot can name its own model later; until it has its own key it uses this one. To move to LiteLLM, change these three values and recreate the API and worker. Nothing in the code names a host, a key, or a model.

On Docker Desktop the containers reach Ollama on the Windows host through `host.docker.internal`. `ollama list` shows the model id. Ollama does not check the key; the client still sends one.

```env
HIVE_MODEL_BASE_URL=http://host.docker.internal:11434/v1
HIVE_MODEL_API_KEY=ollama
HIVE_DEFAULT_MODEL=qwen3.5:2b
MCP_ALLOW_PRIVATE_ENDPOINT=true
```

`MCP_ALLOW_PRIVATE_ENDPOINT=true` lets the API and worker call that private address. Recreate the API and worker after changing `.env`.

More detail on secrets, models, and production TLS is in [docs/self-host.md](../self-host.md) and [docs/self-host-secrets.md](../self-host-secrets.md).
