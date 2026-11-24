// Hive modification: SSO settings and the installation status.
// Derived from Rakazo (Apache License 2.0).

import { Button, Input, Switch } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";

export function HiveSso({ rpc }: { rpc: ReturnType<typeof createSpaceRpc> }) {
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [passwordLogin, setPasswordLogin] = useState(true);
  const [groupMap, setGroupMap] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void rpc.hive
      .sso()
      .then((row) => {
        setIssuer(row.issuer);
        setClientId(row.clientId);
        setEnabled(row.enabled);
        setPasswordLogin(row.passwordLogin);
        setGroupMap(row.groupMap);
        setNotice(row.secretSet ? "Secret saved" : "");
      })
      .catch(() => undefined);
    void rpc.hive
      .status()
      .then((row) => {
        const profiles = Object.entries(row.profiles)
          .filter((entry) => entry[1])
          .map((entry) => entry[0])
          .join(", ");
        const disk =
          row.diskFreeBytes === null ? "" : `, ${Math.round(row.diskFreeBytes / 1_000_000_000)} GB free`;
        const version = row.version ? `${row.version}, ` : "";
        setStatus(`${version}${row.vault}${profiles ? `, ${profiles}` : ""}${disk}`);
      })
      .catch(() => undefined);
  }, [rpc]);

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <Input aria-label="Issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} />
      <Input aria-label="Client ID" value={clientId} onChange={(event) => setClientId(event.target.value)} />
      <Input
        aria-label="Client secret"
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="SSO" />
        SSO
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={passwordLogin} onCheckedChange={setPasswordLogin} aria-label="Password login" />
        Password login
      </label>
      <textarea
        aria-label="Groups"
        className="min-h-16 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        value={groupMap}
        onChange={(event) => setGroupMap(event.target.value)}
      />
      <Button
        type="button"
        onClick={() =>
          void rpc.hive
            .saveSso({
              issuer,
              clientId,
              secret: secret || undefined,
              enabled,
              passwordLogin,
              groupMap,
            })
            .then(() => {
              setSecret("");
              setNotice("Saved");
            })
            .catch(() => setNotice("Could not save"))
        }
      >
        Save
      </Button>
      {notice ? <p className="text-xs">{notice}</p> : null}
      {status ? <p className="text-xs">{status}</p> : null}
    </div>
  );
}
