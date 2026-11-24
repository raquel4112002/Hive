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

After that account exists, public signup stays off (`HIVE_ALLOW_SIGNUP=false`). A later signup does not create another organization and does not become a super-admin. An admin invites the next person from the bot panel: email, role (`ADMIN` or `USER`), and departments. The link expires after seven days and works once. The person opens it, signs up with that email, and joins the same organization. Set `HIVE_ALLOW_SIGNUP=true` only when a new public organization should be allowed.

`RAKAZO_IMAGE` in `.env` names `hive/app`. The checkout Compose file builds the app services itself. Set `RAKAZO_IMAGE` to a registry path only when you pull images instead of building them. The variable names stay `RAKAZO_*`.

## Model

Hive uses one OpenAI-compatible endpoint when a bot has no key of its own. Set all three, or none. Nothing in the code names a host, a key, or a model.

On Docker Desktop the containers reach Ollama on the Windows host through `host.docker.internal`. `ollama list` shows the model id. Ollama does not check the key; the client still sends one.

```env
HIVE_MODEL_BASE_URL=http://host.docker.internal:11434/v1
HIVE_MODEL_API_KEY=ollama
HIVE_DEFAULT_MODEL=qwen3.5:2b
MCP_ALLOW_PRIVATE_ENDPOINT=true
```

`MCP_ALLOW_PRIVATE_ENDPOINT=true` lets the API and worker call that private address.

A LiteLLM proxy is optional. Set both values, or neither. They stay in `.env` and are not sent to the browser. The admin URL is the proxy root, without `/v1`. When they are set, creating a bot can issue a key for one model and an optional monthly budget. Runs use that key. When they are blank, runs keep using the three values above.

```env
HIVE_LITELLM_BASE_URL=http://127.0.0.1:4000
HIVE_LITELLM_MASTER_KEY=
```

Recreate the API and worker after changing `.env`. The key, the budget, and the cost screen are described in [PHASE3.md](PHASE3.md).

## LiteLLM on the production Compose file

`infra/compose/docker-compose.prod.yml` can run the proxy and a database that belongs only to it. A plain `up` leaves both stopped. They start with the `litellm` profile.

Set a password for that database, the master key, the model name Hive should list, and the upstream model. Inside Compose the API and worker call `http://litellm:4000`. The admin UI is on the host at `http://127.0.0.1:4000`.

```env
LITELLM_DB_PASSWORD=
HIVE_LITELLM_MASTER_KEY=
HIVE_LITELLM_BASE_URL=http://litellm:4000
HIVE_DEFAULT_MODEL=qwen3.5:2b
LITELLM_MODEL=ollama/qwen3.5:2b
LITELLM_API_BASE=http://host.docker.internal:11434
```

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml --profile litellm up -d
```

Another model is another entry in `infra/compose/litellm.yaml`. The shipped file sets `input_cost_per_token` and `output_cost_per_token` to 0. Ollama has no price of its own, so dollars stay at 0.00 and a monthly budget does not run out. Costs still shows the token count beside the dollars. A trial priced each output token at 0.02 so a budget could run out; that temporary price is what the Costs screen added up as 22.53 and 5.81. Those numbers are not the product default. Set the two prices above zero only when a monthly budget should be able to run out.

More detail on secrets, models, and production TLS is in [docs/self-host.md](../self-host.md) and [docs/self-host-secrets.md](../self-host-secrets.md).
