// Hive modification: assign a bot to Todos. Derived from Rakazo (Apache License 2.0).

import { Button, Input, Switch } from "@rakazo/ui-web";
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
    bots: { name: string; spendUsd: number }[];
    departments: { name: string; spendUsd: number }[];
  } | null>(null);

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
    return () => {
      live = false;
    };
  }, [rpc]);

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
              bots: report.bots.map((row) => ({ name: row.name, spendUsd: row.spendUsd })),
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
              {row.name} {row.spendUsd.toFixed(2)}
            </span>
          ))}
          {costs.departments.map((row) => (
            <span key={`dept-${row.name}`} className="mr-3">
              {row.name} {row.spendUsd.toFixed(2)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
