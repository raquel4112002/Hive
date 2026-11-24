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

## OpenBao

Bot credentials can stay in the encrypted store (`SECRET_STORE=encrypted`) or move to OpenBao (`SECRET_STORE=openbao`). A plain `up` does not start the vault. Start it with the `vault` profile, on the dev file or the production file:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml --profile vault up -d openbao
```

The process starts sealed. Initialize it once. That prints the unseal keys and the root token. Keep them outside the repository and outside `.env`.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml exec openbao bao operator init
```

Set `OPENBAO_ADDR=http://openbao:8200`, `OPENBAO_TOKEN` to the root token, and `SECRET_STORE=openbao`, then recreate the API and the worker. The first start creates the kv version 2 mount at `secret/` when that path is empty. After the mount exists, create a management token that can write secrets and policies and cannot read `secret/data/org/`. Put that token in `OPENBAO_TOKEN`, leave the root token offline, and recreate the API and the worker again. Each bot receives its own policy for `org/<orgId>/bot/<botId>/`. Archiving the bot deletes that policy.

### Unseal by hand

This install uses a manual unseal. A restart seals the process again. The data is still on the volume. Until it is unsealed, `/ready` and the API health check report `cofre selado`, the admin portal shows the same words, and a run that needs a credential fails with that message instead of staying at work.

`unseal` asks for a key. Repeat it until the status says unsealed. Then the next run can read credentials again.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml exec openbao bao operator unseal
```

### Unseal by itself in production

OpenBao can unseal on startup with a transit seal or a cloud KMS (AWS KMS, GCP KMS, or Azure Key Vault). This install does not turn that on. A production host that should come back without an operator adds a `seal` stanza to `infra/compose/openbao.hcl` and keeps the recovery keys offline. A transit seal looks like this, with the address and token of a separate OpenBao that only holds the unseal key:

```hcl
seal "transit" {
  address    = "https://unseal.example"
  token      = "replace-with-the-transit-token"
  key_name   = "hive-unseal"
  mount_path = "transit/"
}
```

A cloud KMS uses its own stanza, for example `seal "awskms"` with `region` and `kms_key_id`. After that stanza is in place, a restart unseals itself. Keep the original unseal keys as well: losing both the KMS key and those keys loses the credentials.

### Backup and restore

Stop OpenBao, copy the `openbao` volume, and store the unseal keys with that copy. Restoring the volume without the keys does not reveal the credentials.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml stop openbao
docker run --rm -v <project>_openbao:/from -v <project>_openbao_backup:/to alpine tar -C /from -cf /to/openbao.tar .
```

`<project>` is the Compose project name. On a clean server, create an empty volume, unpack the archive into it, start OpenBao with that volume and the same `openbao.hcl`, and unseal with the saved keys. The paths come back only after unseal.

```bash
docker volume create <project>_openbao_restore
docker run --rm -v <project>_openbao_backup:/from -v <project>_openbao_restore:/to alpine tar -C /to -xf /from/openbao.tar
```

Point the OpenBao service at `<project>_openbao_restore` instead of `openbao`, start it, and run `bao operator unseal` until it is unsealed. A restore onto a new volume, unsealed with the saved keys, returned the credential that had been stored before the copy. Do not put the keys, the root token, or a credential value in git, in a log, or in a backup note.

More detail on secrets, models, and production TLS is in [docs/self-host.md](../self-host.md) and [docs/self-host-secrets.md](../self-host-secrets.md). The credential rules are in [PHASE4.md](PHASE4.md).

## Knowledge

Knowledge files need a Postgres image that includes pgvector. The Compose files use `pgvector/pgvector`. A volume created by Postgres 18 stays valid when the image changes to the pgvector build of the same major version. Apply the migrations after that image is the one running.

MinIO keeps the original files. A plain `up` does not start it. Start it with the `knowledge` profile:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml --profile knowledge up -d minio
```

The public MinIO registries no longer allow an anonymous pull, so the service uses the Chainguard MinIO image. It is the MinIO server. Set these in `.env` and recreate the API and the worker. They stay on the server. The browser never receives them.

```bash
HIVE_KNOWLEDGE_ENDPOINT=http://minio:9000
HIVE_KNOWLEDGE_BUCKET=hive-knowledge
HIVE_KNOWLEDGE_ACCESS_KEY=hive-knowledge
HIVE_KNOWLEDGE_SECRET_KEY=replace-with-a-long-password
```

The access key needs at least 3 characters and the secret at least 8. The first upload creates the bucket.

Embeddings go to LiteLLM at `HIVE_LITELLM_BASE_URL` when that is set, and otherwise to `HIVE_MODEL_BASE_URL`. Both speak the same embeddings API. Set `HIVE_EMBEDDING_MODEL` to a model that returns 768 numbers, for example an embedding model served by Ollama through LiteLLM. Leave it blank and a document stays failed with no vectors stored.

### Backup and restore

Stop MinIO and copy the `minio` volume next to the Postgres backup and the OpenBao backup. Restoring the database without this volume loses the original files. Restoring the volume without the database loses the chunks, the embeddings, and the permissions.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml stop minio
docker run --rm -v <project>_minio:/from -v <project>_minio_backup:/to alpine tar -C /from -cf /to/minio.tar .
```

On a clean server, create `<project>_minio_restore`, unpack the archive into it, point the MinIO service at that volume, and start it with the same access key and secret. The knowledge rules are in [PHASE5.md](PHASE5.md).
