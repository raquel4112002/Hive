import { VAULT_SEALED_MESSAGE } from "@rakazo/core";
import { useQuery } from "@tanstack/react-query";

/** Admin notice while OpenBao is sealed. The words match the health check and a failed run. */
export function VaultSealNotice({
  rpc,
}: {
  rpc: { hive: { vaultStatus: () => Promise<{ sealed: boolean }> } };
}) {
  const status = useQuery({
    queryKey: ["hive", "vault-status"],
    queryFn: () => rpc.hive.vaultStatus(),
    refetchInterval: 15_000,
  });
  if (!status.data?.sealed) return null;
  return (
    <p
      role="status"
      className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-[13px] text-warning"
    >
      {VAULT_SEALED_MESSAGE}
    </p>
  );
}
