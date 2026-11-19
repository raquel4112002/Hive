// Hive modification: assign a bot to Todos. Derived from Rakazo (Apache License 2.0).

import { Button, Switch } from "@rakazo/ui-web";
import { useState } from "react";
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
    </div>
  );
}
