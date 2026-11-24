// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { VaultSealNotice } from "./vault-seal-notice";

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows the sealed vault to an admin", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <VaultSealNotice rpc={{ hive: { vaultStatus: async () => ({ sealed: true }) } }} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.textContent).toBe("cofre selado");
  root.unmount();
});

it("stays quiet while the vault is open", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <VaultSealNotice rpc={{ hive: { vaultStatus: async () => ({ sealed: false }) } }} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.textContent).toBe("");
  root.unmount();
});
