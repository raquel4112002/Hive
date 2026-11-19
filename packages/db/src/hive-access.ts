// Hive modification: who may use a bot, and who may change one.
// Derived from Rakazo (Apache License 2.0).

export type HiveRoleName = "SUPER_ADMIN" | "ADMIN" | "USER";
export type HiveAccessLevel = "CHAT" | "READ_ONLY";

export const EVERYONE_DEPARTMENT_NAME = "Todos";

/** The highest assignment wins. One CHAT path is enough. */
export function effectiveAccess(levels: readonly HiveAccessLevel[]): HiveAccessLevel | null {
  if (levels.includes("CHAT")) return "CHAT";
  if (levels.includes("READ_ONLY")) return "READ_ONLY";
  return null;
}

/** A person thread exists only for CHAT on a bot that is not a publication. */
export function conversationAllowed(input: {
  access: HiveAccessLevel | null;
  publication: boolean;
}): boolean {
  return input.access === "CHAT" && !input.publication;
}

export function asAccessLevel(value: string): HiveAccessLevel {
  return value === "READ_ONLY" ? "READ_ONLY" : "CHAT";
}

/** Routes a USER cannot call. Conversation on their own thread stays open. */
export const HIVE_USER_BLOCKED = new Set([
  "bots.create",
  "bots.importPreview",
  "bots.importCreate",
  "bots.duplicate",
  "bots.reorder",
  "bots.update",
  "bots.restoreInstructions",
  "bots.setComputer",
  "bots.archive",
  "bots.restore",
  "bots.remove",
  "bots.rotateWebhookSecret",
  "groups.create",
  "groups.duplicate",
  "groups.update",
  "groups.archive",
  "groups.restore",
  "groups.remove",
  "botSections.create",
  "botSections.update",
  "botSections.remove",
  "onboarding.start",
  "onboarding.promptFocus",
  "onboarding.choose",
  "onboarding.dismissFocus",
  "onboarding.appConnected",
  "routines.create",
  "routines.update",
  "routines.remove",
  "routines.testRun",
  "mcp.servers.create",
  "mcp.servers.update",
  "mcp.servers.remove",
  "mcp.servers.test",
  "mcp.assignments.approve",
  "mcp.assignments.dismiss",
  "mcp.assignments.replace",
  "mcp.oauth.begin",
  "mcp.oauth.complete",
  "mcp.oauth.disconnect",
  "vault.list",
  "vault.put",
  "vault.reveal",
  "vault.remove",
  "botSecrets.list",
  "botSecrets.put",
  "botSecrets.remove",
  "agentSecrets.list",
  "agentSecrets.put",
  "agentSecrets.remove",
  "skills.start",
  "skills.appendEvent",
  "skills.snapshot",
  "skills.stop",
  "skills.updateDraft",
  "skills.save",
  "skills.testRun",
  "skills.remove",
  "agentSkills.list",
  "agentSkills.get",
  "agentSkills.create",
  "agentSkills.update",
  "agentSkills.remove",
  "availability.set",
  "availability.chooseForSpace",
  "computer.boot",
  "computer.stop",
  "computer.recover",
  "computer.reset",
  "computer.update",
  "computer.releaseInterrupted",
  "computer.dismissUpdate",
  "computer.takeover",
  "computer.release",
  "computer.input",
  "computer.uploadFile",
  "computer.files",
  "computer.readFile",
  "computer.downloadFile",
  "computer.terminalUrl",
  "computer.commands",
  "connections.begin",
  "connections.complete",
  "connections.rename",
  "connections.revoke",
  "capabilities.install",
  "capabilities.pluginParts",
  "capabilities.remove",
  "integrationSetup.save",
  "marketplace.review",
  "models.connect",
  "models.disconnect",
  "models.rename",
  "models.setDefault",
  "models.setRole",
  "models.setBackups",
  "models.beginOAuth",
  "models.submitOAuthCode",
  "models.completeOAuth",
  "models.finishOAuth",
  "models.cancelOAuth",
  "models.probeOpenAiCompatible",
  "models.probeCatalog",
  "models.list",
  "models.credentials",
  "hive.linkConnection",
  "hive.assignDepartment",
  "hive.setPublication",
]);

export function userMayCall(role: HiveRoleName | null, procedure: string): boolean {
  if (role !== "USER") return true;
  return !HIVE_USER_BLOCKED.has(procedure);
}

export function serviceAccountId(organizationId: string): string {
  return `hive-service-${organizationId}`;
}

export function serviceAccountEmail(organizationId: string): string {
  return `service+${organizationId}@hive.invalid`;
}

/** A bot link accepts only the organization's service account. */
export function serviceConnectionOwner(connectionUserId: string, serviceUserId: string): boolean {
  return connectionUserId === serviceUserId;
}

export function personRemovalPlan(
  settings: { personRemovalMode?: string | null; personArchiveDays?: number | null } | null,
  now: Date,
): { mode: "archive"; deleteAfter: Date } | { mode: "delete" } {
  if (settings?.personRemovalMode === "delete") return { mode: "delete" };
  const days =
    settings?.personArchiveDays && settings.personArchiveDays > 0 ? settings.personArchiveDays : 30;
  return {
    mode: "archive",
    deleteAfter: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
  };
}

/** Archived people stay out of every list. Inspect is a separate lease. */
export function personListed(archivedAt: Date | null): boolean {
  return archivedAt == null;
}

export function routineRecipientUserIds(input: {
  recipients: { userId?: string | null; departmentId?: string | null }[];
  departmentMembers: { departmentId: string; userId: string }[];
}): string[] {
  const ids = new Set<string>();
  for (const recipient of input.recipients) {
    if (recipient.userId) ids.add(recipient.userId);
    if (!recipient.departmentId) continue;
    for (const member of input.departmentMembers) {
      if (member.departmentId === recipient.departmentId) ids.add(member.userId);
    }
  }
  return [...ids].sort();
}

/** One delivery per person. Nothing here is a shared thread. */
export function routineDeliveries(userIds: readonly string[]): { userId: string }[] {
  return userIds.map((userId) => ({ userId }));
}

export function delegationAllowed(assignedBotIds: readonly string[], targetBotId: string): boolean {
  return assignedBotIds.includes(targetBotId);
}

/** AAD record id for the installation model sealed in DeploymentSettings. */
export const INSTALLATION_MODEL_RECORD_ID = "deployment-model";

export function hiveModelSource(
  isServiceBot: boolean,
  hasInstallationCipher: boolean,
): "installation" | "missing" | "member" {
  if (!isServiceBot) return "member";
  return hasInstallationCipher ? "installation" : "missing";
}

const HIVE_MAX_ACTIVE_COMPUTERS_ENV = "HIVE_MAX_ACTIVE_COMPUTERS";
const HIVE_COMPUTER_IDLE_MINUTES_ENV = "HIVE_COMPUTER_IDLE_MINUTES";

function positiveInt(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

/** Install-wide dedicated-computer cap and idle time. Blank or invalid values use 2 and 30. */
export function hiveComputerLimits(env: NodeJS.ProcessEnv = process.env): {
  activeLimit: number;
  idleMinutes: number;
} {
  return {
    activeLimit: positiveInt(env[HIVE_MAX_ACTIVE_COMPUTERS_ENV], 2),
    idleMinutes: positiveInt(env[HIVE_COMPUTER_IDLE_MINUTES_ENV], 30),
  };
}

export function dedicatedScreenAllowed(input: {
  callerRole: HiveRoleName | null;
  computerScope: string;
  slotUserId: string;
  callerUserId: string;
  slotState: string;
}): boolean {
  return (
    input.callerRole === "USER" &&
    input.computerScope === "dedicated" &&
    input.slotUserId === input.callerUserId &&
    input.slotState === "running"
  );
}

export interface ComputerSlot {
  key: string;
  state: "running" | "queued" | "stopped";
  lastActiveAt: number | null;
  queuedAt: number | null;
}

function cloneSlots(slots: readonly ComputerSlot[]): ComputerSlot[] {
  return slots.map((slot) => ({ ...slot }));
}

/** Stop idle machines, then start the oldest queued ones that fit. */
export function settleComputers(
  slots: readonly ComputerSlot[],
  now: number,
  idleMs: number,
  limit: number,
): ComputerSlot[] {
  const next = cloneSlots(slots);
  for (const slot of next) {
    if (
      slot.state === "running" &&
      slot.lastActiveAt != null &&
      now - slot.lastActiveAt >= idleMs
    ) {
      slot.state = "stopped";
      slot.queuedAt = null;
    }
  }
  const queued = next
    .filter((slot) => slot.state === "queued")
    .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0) || a.key.localeCompare(b.key));
  for (const slot of queued) {
    if (next.filter((item) => item.state === "running").length >= limit) break;
    slot.state = "running";
    slot.lastActiveAt = now;
    slot.queuedAt = null;
  }
  return next;
}

export function requestComputer(
  slots: readonly ComputerSlot[],
  key: string,
  now: number,
  idleMs: number,
  limit: number,
): ComputerSlot[] {
  const settled = settleComputers(slots, now, idleMs, limit).filter((slot) => slot.key !== key);
  const previous = slots.find((slot) => slot.key === key);
  const current = settleComputers(slots, now, idleMs, limit).find((slot) => slot.key === key);
  if (current?.state === "running") {
    return [...settled, { ...current, lastActiveAt: now }];
  }
  if (settled.filter((slot) => slot.state === "running").length < limit) {
    return [...settled, { key, state: "running", lastActiveAt: now, queuedAt: null }];
  }
  return [
    ...settled,
    {
      key,
      state: "queued",
      lastActiveAt: current?.lastActiveAt ?? previous?.lastActiveAt ?? null,
      queuedAt: current?.queuedAt ?? previous?.queuedAt ?? now,
    },
  ];
}
