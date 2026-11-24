import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { OpenBaoSecretStore } from "./openbao-secret-store.js";

function context(): AdapterContext {
  return {
    operationId: "op",
    traceId: "trace",
    userId: "user",
    spaceId: "space",
    signal: new AbortController().signal,
  };
}

function vault() {
  const secrets = new Map<string, string>();
  const policies = new Map<string, string>();
  const tokens = new Map<string, string>([["root", "management"]]);
  let issued = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.slice(url.indexOf("/v1/") + 4);
    const method = init?.method ?? "GET";
    const token = new Headers(init?.headers).get("x-vault-token") ?? "";
    const role = tokens.get(token);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const deny = () => new Response("no", { status: 403 });
    if (path.startsWith("sys/policies/acl/")) {
      if (role !== "management") return deny();
      const name = path.slice("sys/policies/acl/".length);
      if (method === "DELETE") policies.delete(name);
      else policies.set(name, String(body.policy ?? ""));
      return new Response(null, { status: 204 });
    }
    if (path === "auth/token/create") {
      if (role !== "management") return deny();
      const name = `bot-token-${issued++}`;
      const policy = (body.policies as string[])[0] ?? "";
      tokens.set(name, policy);
      return Response.json({ auth: { client_token: name } });
    }
    if (path === "auth/token/revoke") {
      if (role !== "management") return deny();
      tokens.delete(String(body.token ?? ""));
      return new Response(null, { status: 204 });
    }
    if (path === "sys/mounts" && method === "GET") {
      return Response.json({
        data: secrets.has("mounted")
          ? { "secret/": { type: "kv", options: { version: "2" } } }
          : {},
      });
    }
    if (path === "sys/mounts/secret" && method === "POST") {
      if (role !== "management") return deny();
      secrets.set("mounted", "yes");
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("secret/data/")) {
      const dataPath = path.slice("secret/data/".length);
      if (dataPath.startsWith("hive/runtime/")) {
        if (role !== "management") return deny();
        if (method === "GET") {
          const tokenValue = secrets.get(dataPath);
          if (!tokenValue) return new Response("missing", { status: 404 });
          return Response.json({ data: { data: { token: tokenValue } } });
        }
        secrets.set(dataPath, String((body.data as { token?: string }).token ?? ""));
        return Response.json({ data: {} });
      }
      if (method === "GET") {
        const policy = policies.get(role ?? "");
        if (!policy || !policy.includes(dataPath.slice(0, dataPath.lastIndexOf("/")))) return deny();
        const value = secrets.get(dataPath);
        if (value === undefined) return new Response("missing", { status: 404 });
        return Response.json({ data: { data: { value } } });
      }
      if (role !== "management") return deny();
      secrets.set(dataPath, String((body.data as { value?: string }).value ?? ""));
      return Response.json({ data: {} });
    }
    return new Response("missing", { status: 404 });
  };
  return fetchImpl;
}

describe("OpenBao bot vault", () => {
  it("lets bot A read only its own secret, and archive removes that access", async () => {
    const store = new OpenBaoSecretStore({
      address: "http://openbao.test",
      token: "root",
      fetch: vault(),
    });
    const secret = "mailbox-password";
    const saved = await store.put(secret, context(), {
      recordId: "org/org-1/bot/bot-a/email",
    });
    expect(saved.ciphertext).not.toContain(secret);
    expect(await store.load(saved.ciphertext, "bot:bot-a")).toBe(secret);
    await expect(store.load(saved.ciphertext, "bot:bot-b")).rejects.toThrow(
      "Secret reference does not resolve",
    );
    await store.revokeBot("bot-a");
    await expect(store.load(saved.ciphertext, "bot:bot-a")).rejects.toThrow(
      "Secret reference does not resolve",
    );
  });

  it("enables the kv mount once when secret/ is empty", async () => {
    let posts = 0;
    const inner = vault();
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/v1/sys/mounts/secret") && init?.method === "POST") posts += 1;
      return inner(input, init);
    };
    const store = new OpenBaoSecretStore({
      address: "http://openbao.test",
      token: "root",
      fetch: fetchImpl,
    });
    await store.start();
    await store.start();
    expect(posts).toBe(1);
  });
});
