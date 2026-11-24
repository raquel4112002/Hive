import type {
  AdapterContext,
  SecretContext,
  SecretPutOptions,
  SecretRecord,
  SecretStore,
} from "@rakazo/adapter-kit";
import { SecretNotFoundError, SecretStoreUnavailableError } from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { SecretChanges } from "./secret-changes.js";

export const OPENBAO_REF_PREFIX = "openbao:v1:";
const PATH = /^org\/([A-Za-z0-9_-]+)\/bot\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;

export interface OpenBaoSecretStoreOptions {
  address: string;
  token: string;
  fetch?: typeof fetch;
}

export function openBaoOptionsFromEnv(source: NodeJS.ProcessEnv): OpenBaoSecretStoreOptions {
  const address = source.OPENBAO_ADDR?.trim() ?? "";
  const token = source.OPENBAO_TOKEN?.trim() ?? "";
  if (!address) throw new Error("Missing OPENBAO_ADDR");
  if (!token) throw new Error("Missing OPENBAO_TOKEN");
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Invalid OPENBAO_ADDR");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid OPENBAO_ADDR");
  return { address: url.origin, token };
}

function recordId(context: SecretContext): string {
  return typeof context === "string" ? context : context.recordId;
}

/** A bot id passed by a caller. Other record ids stay on the path's own bot. */
function requestedBot(context: SecretContext, pathBot: string): string {
  const record = recordId(context);
  if (record.startsWith("bot:")) return record.slice(4);
  if (record.startsWith("bot-model-")) return record.slice("bot-model-".length);
  return pathBot;
}

/** One OpenBao KV mount. The management token writes. Only that bot's token reads. */
export class OpenBaoSecretStore extends SecretChanges implements SecretStore {
  readonly refPrefix = OPENBAO_REF_PREFIX;
  private readonly tokens = new Map<string, string>();
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: OpenBaoSecretStoreOptions) {
    super();
    this.fetcher = options.fetch ?? fetch;
  }
  describe() {
    return {
      id: "openbao",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { rotate: true },
    };
  }
  async start(): Promise<void> {
    const listed = (await this.request("GET", "sys/mounts", this.options.token)) as
      | { data?: Record<string, { type?: string; options?: { version?: string } }> }
      | undefined;
    const secret = listed?.data?.["secret/"];
    if (secret?.type === "kv" && String(secret.options?.version ?? "") === "2") return;
    if (secret) throw new SecretStoreUnavailableError();
    await this.request("POST", "sys/mounts/secret", this.options.token, {
      type: "kv",
      options: { version: "2" },
    });
  }
  async close(): Promise<void> {
    this.tokens.clear();
  }
  async put(
    plaintext: string,
    _context: AdapterContext,
    options: SecretPutOptions = {},
  ): Promise<SecretRecord> {
    const path = options.recordId ?? "";
    const parsed = PATH.exec(path);
    if (!parsed) throw new Error("Invalid credential path");
    const botId = parsed[2]!;
    await this.ensureBot(parsed[1]!, botId);
    await this.request("POST", `secret/data/${path}`, this.options.token, {
      data: { value: plaintext },
    });
    const ref = `${OPENBAO_REF_PREFIX}${path}`;
    this.changed(ref);
    return { id: path, ref, ciphertext: ref };
  }
  async load(ref: string, context: SecretContext): Promise<string> {
    const path = this.pathOf(ref);
    const parsed = PATH.exec(path);
    if (!parsed) throw new SecretNotFoundError();
    const botId = parsed[2]!;
    if (requestedBot(context, botId) !== botId) throw new SecretNotFoundError();
    const token = await this.botToken(parsed[1]!, botId);
    const body = await this.request("GET", `secret/data/${path}`, token);
    const value = body?.data?.data?.value;
    if (typeof value !== "string") throw new SecretNotFoundError();
    return value;
  }
  async delete(ref: string, context: SecretContext): Promise<void> {
    const path = this.pathOf(ref);
    const parsed = PATH.exec(path);
    if (!parsed || requestedBot(context, parsed[2]!) !== parsed[2]) throw new SecretNotFoundError();
    await this.request("DELETE", `secret/metadata/${path}`, this.options.token);
    this.changed(ref);
  }
  async revokeBot(botId: string): Promise<void> {
    const token = this.tokens.get(botId);
    this.tokens.delete(botId);
    if (token) {
      await this.request("POST", "auth/token/revoke", this.options.token, { token }).catch(
        () => undefined,
      );
    }
    await this.request("DELETE", `sys/policies/acl/${policyName(botId)}`, this.options.token).catch(
      () => undefined,
    );
  }
  redact(value: string): string {
    return value ? "[redacted]" : value;
  }
  private pathOf(ref: string): string {
    if (!ref.startsWith(OPENBAO_REF_PREFIX)) throw new SecretNotFoundError();
    return ref.slice(OPENBAO_REF_PREFIX.length);
  }
  private async ensureBot(orgId: string, botId: string): Promise<void> {
    if (this.tokens.has(botId)) return;
    const policy = policyName(botId);
    await this.request("PUT", `sys/policies/acl/${policy}`, this.options.token, {
      policy: `path "secret/data/org/${orgId}/bot/${botId}/*" { capabilities = ["read"] }`,
    });
    const created = await this.request("POST", "auth/token/create", this.options.token, {
      policies: [policy],
      ttl: "720h",
    });
    const token = created?.auth?.client_token;
    if (typeof token !== "string" || !token) throw new SecretStoreUnavailableError();
    this.tokens.set(botId, token);
    await this.request("POST", `secret/data/hive/runtime/${botId}`, this.options.token, {
      data: { token },
    });
  }
  private async botToken(orgId: string, botId: string): Promise<string> {
    const cached = this.tokens.get(botId);
    if (cached) return cached;
    try {
      const body = await this.request(
        "GET",
        `secret/data/hive/runtime/${botId}`,
        this.options.token,
      );
      const token = body?.data?.data?.token;
      if (typeof token === "string" && token) {
        this.tokens.set(botId, token);
        return token;
      }
    } catch (error) {
      if (!(error instanceof SecretNotFoundError)) throw error;
    }
    await this.ensureBot(orgId, botId);
    return this.tokens.get(botId)!;
  }
  private async request(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ data?: { data?: { value?: string; token?: string } }; auth?: { client_token?: string } } | undefined> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.address}/v1/${path}`, {
        method,
        headers: {
          "x-vault-token": token,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (error instanceof SecretStoreUnavailableError || error instanceof SecretNotFoundError)
        throw error;
      getLogger().warn("OpenBao request failed");
      throw new SecretStoreUnavailableError();
    }
    if (response.status === 404) throw new SecretNotFoundError();
    if (response.status === 403) throw new SecretNotFoundError();
    if (!response.ok && response.status !== 204) throw new SecretStoreUnavailableError();
    if (response.status === 204) return undefined;
    return (await response.json().catch(() => undefined)) as
      | { data?: { data?: { value?: string; token?: string } }; auth?: { client_token?: string } }
      | undefined;
  }
}

function policyName(botId: string): string {
  return `hive-bot-${botId}`;
}
