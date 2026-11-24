// Hive modification: the invite token stays on this request, not on the user row.
// Derived from Rakazo (Apache License 2.0).

const pending = new Map<string, string>();

function key(email: string): string {
  return email.trim().toLowerCase();
}

export function rememberHiveInvite(email: string, token: string): void {
  pending.set(key(email), token);
}

export function takeHiveInvite(email: string): string | undefined {
  const token = pending.get(key(email));
  if (token) pending.delete(key(email));
  return token;
}
