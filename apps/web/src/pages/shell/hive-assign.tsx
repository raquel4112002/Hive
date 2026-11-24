// Hive modification: assign a bot to Todos. Derived from Rakazo (Apache License 2.0).

import { Button, Input, Switch } from "@rakazo/ui-web";
import { HiveBrandSettings } from "./hive-brand";
import { HiveKnowledge } from "./hive-knowledge";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";

export function HiveAssign({
  botId,
  publication,
  rpc,
  onChanged,
}: {
  botId: string;
  publication: boolean;
  rpc: ReturnType<typeof createSpaceRpc>;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [budget, setBudget] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [costs, setCosts] = useState<{
    month: string;
    bots: { name: string; spendUsd: number; tokens: number }[];
    departments: { name: string; spendUsd: number; tokens: number }[];
  } | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "USER">("USER");
  const [inviteDepartments, setInviteDepartments] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [credentialKind, setCredentialKind] = useState<"email" | "login" | "api_key">("email");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialValue, setCredentialValue] = useState("");
  const [credentials, setCredentials] = useState<
    { id: string; kind: string; label: string; updatedAt: string }[]
  >([]);

  useEffect(() => {
    let live = true;
    rpc.hive
      .modelCatalog()
      .then((catalog) => {
        if (!live || !catalog.enabled) return;
        setModels(catalog.models);
        setModel(catalog.models[0] ?? "");
      })
      .catch(() => undefined);
    rpc.hive
      .credentials({ botId })
      .then((rows) => {
        if (live) setCredentials(rows);
      })
      .catch(() => undefined);
    rpc.hive
      .departments()
      .then((rows) => {
        if (live) setDepartments(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [botId, rpc]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      <HiveBrandSettings botId={botId} rpc={rpc} />
      <HiveKnowledge botId={botId} rpc={rpc} />
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <span className="text-sm">Publication</span>
      <Switch
        checked={publication}
        disabled={busy}
        onCheckedChange={(checked) => {
          void run(() => rpc.hive.setPublication({ botId, publication: checked }));
        }}
        aria-label="Publication"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void run(() =>
            rpc.hive.assignDepartment({ botId, everyone: true, accessLevel: "CHAT" }),
          );
        }}
      >
        Todos
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void run(() =>
            rpc.hive.assignDepartment({ botId, everyone: true, accessLevel: "READ_ONLY" }),
          );
        }}
      >
        Todos read only
      </Button>
      {models.length > 0 ? (
        <>
          <select
            aria-label="Model"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={model}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Input
            aria-label="Monthly budget"
            placeholder="Monthly budget"
            className="h-8 w-32"
            value={budget}
            disabled={busy}
            onChange={(event) => setBudget(event.target.value)}
          />
          <Input
            aria-label="Existing key"
            placeholder="Existing key"
            type="password"
            autoComplete="off"
            className="h-8 w-36"
            value={modelKey}
            disabled={busy}
            onChange={(event) => setModelKey(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !model}
            onClick={() => {
              const monthlyBudget = budget.trim() ? Number(budget) : null;
              void run(() =>
                rpc.hive.setModel({
                  botId,
                  model,
                  monthlyBudget: monthlyBudget && monthlyBudget > 0 ? monthlyBudget : null,
                  ...(modelKey.trim() ? { modelKey: modelKey.trim() } : {}),
                }),
              );
            }}
          >
            Model
          </Button>
        </>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          const month = new Date().toISOString().slice(0, 7);
          void run(async () => {
            const report = await rpc.hive.spend({ month });
            setCosts({
              month: report.month,
              bots: report.bots.map((row) => ({
                name: row.name,
                spendUsd: row.spendUsd,
                tokens: row.tokens,
              })),
              departments: report.departments,
            });
          });
        }}
      >
        Costs
      </Button>
      {costs ? (
        <div className="basis-full text-sm text-muted-foreground">
          <span className="mr-3">{costs.month}</span>
          {costs.bots.map((row) => (
            <span key={row.name} className="mr-3">
              {row.name} {row.spendUsd.toFixed(2)} ({row.tokens})
            </span>
          ))}
          {costs.departments.map((row) => (
            <span key={`dept-${row.name}`} className="mr-3">
              {row.name} {row.spendUsd.toFixed(2)} ({row.tokens})
            </span>
          ))}
        </div>
      ) : null}
      <select
        aria-label="Kind"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value={credentialKind}
        disabled={busy}
        onChange={(event) =>
          setCredentialKind(
            event.target.value === "login" || event.target.value === "api_key"
              ? event.target.value
              : "email",
          )
        }
      >
        <option value="email">Email</option>
        <option value="login">Login</option>
        <option value="api_key">API key</option>
      </select>
      <Input
        aria-label="Label"
        placeholder="Label"
        className="h-8 w-32"
        value={credentialLabel}
        disabled={busy}
        onChange={(event) => setCredentialLabel(event.target.value)}
      />
      <Input
        aria-label="Value"
        placeholder="Value"
        type="password"
        className="h-8 w-40"
        value={credentialValue}
        disabled={busy}
        onChange={(event) => setCredentialValue(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !credentialLabel.trim() || !credentialValue}
        onClick={() => {
          void run(async () => {
            const saved = await rpc.hive.saveCredential({
              botId,
              kind: credentialKind,
              label: credentialLabel.trim(),
              value: credentialValue,
            });
            setCredentialValue("");
            setCredentials((current) => [
              ...current.filter((row) => row.label !== saved.label),
              saved,
            ]);
          });
        }}
      >
        Save
      </Button>
      {credentials.map((row) => (
        <span key={row.id} className="flex items-center gap-2 text-sm">
          <span>
            {row.label} Set {row.updatedAt.slice(0, 10)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await rpc.hive.removeCredential({ botId, label: row.label });
                setCredentials((current) => current.filter((item) => item.id !== row.id));
              });
            }}
          >
            Remove
          </Button>
        </span>
      ))}
      <Input
        aria-label="Email"
        placeholder="Email"
        className="h-8 w-44"
        value={inviteEmail}
        disabled={busy}
        onChange={(event) => setInviteEmail(event.target.value)}
      />
      <select
        aria-label="Role"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value={inviteRole}
        disabled={busy}
        onChange={(event) => setInviteRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")}
      >
        <option value="USER">User</option>
        <option value="ADMIN">Admin</option>
      </select>
      {departments.map((department) => (
        <label key={department.id} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={inviteDepartments.includes(department.id)}
            disabled={busy}
            onChange={(event) => {
              setInviteDepartments((current) =>
                event.target.checked
                  ? [...current, department.id]
                  : current.filter((id) => id !== department.id),
              );
            }}
          />
          {department.name}
        </label>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !inviteEmail.trim()}
        onClick={() => {
          void run(async () => {
            const created = await rpc.hive.invite({
              email: inviteEmail.trim(),
              role: inviteRole,
              departmentIds: inviteDepartments,
            });
            setInviteLink(created.link);
          });
        }}
      >
        Invite
      </Button>
      {inviteLink ? (
        <Input aria-label="Invite link" readOnly className="h-8 w-64" value={inviteLink} />
      ) : null}
    </div>
    </div>
  );
}
