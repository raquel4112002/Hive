import { describe, expect, it } from "vitest";
import {
  conversationAllowed,
  dedicatedScreenAllowed,
  effectiveAccess,
  delegationAllowed,
  hiveComputerLimits,
  hiveModelSource,
  personListed,
  personRemovalPlan,
  requestComputer,
  routineDeliveries,
  routineRecipientUserIds,
  serviceConnectionOwner,
  userMayCall,
} from "./hive-access.js";

describe("hive access", () => {
  it("lets a USER talk and refuses the edit routes", () => {
    expect(userMayCall("USER", "threads.send")).toBe(true);
    expect(userMayCall("USER", "bots.update")).toBe(false);
    expect(userMayCall("USER", "routines.create")).toBe(false);
    expect(userMayCall("USER", "mcp.servers.create")).toBe(false);
    expect(userMayCall("USER", "vault.put")).toBe(false);
    expect(userMayCall("USER", "agentSkills.create")).toBe(false);
    expect(userMayCall("USER", "computer.boot")).toBe(false);
    expect(userMayCall("USER", "connections.begin")).toBe(false);
    expect(userMayCall("USER", "models.connect")).toBe(false);
    expect(userMayCall("USER", "computer.screenUrl")).toBe(true);
    expect(userMayCall("ADMIN", "bots.update")).toBe(true);
    expect(userMayCall(null, "bots.update")).toBe(true);
  });

  it("refuses a personal connection and accepts the service account", () => {
    expect(serviceConnectionOwner("person", "service")).toBe(false);
    expect(serviceConnectionOwner("service", "service")).toBe(true);
  });

  it("archives by default and can delete immediately", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const archived = personRemovalPlan(null, now);
    expect(archived.mode).toBe("archive");
    if (archived.mode === "archive") {
      expect(archived.deleteAfter.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    }
    expect(personRemovalPlan({ personRemovalMode: "delete" }, now)).toEqual({ mode: "delete" });
    expect(personListed(now)).toBe(false);
    expect(personListed(null)).toBe(true);
  });

  it("delivers a routine to each person in the area", () => {
    const users = routineRecipientUserIds({
      recipients: [{ departmentId: "area" }],
      departmentMembers: [
        { departmentId: "area", userId: "b" },
        { departmentId: "area", userId: "a" },
        { departmentId: "other", userId: "c" },
      ],
    });
    expect(users).toEqual(["a", "b"]);
    expect(routineDeliveries(users)).toEqual([{ userId: "a" }, { userId: "b" }]);
  });

  it("does not delegate to a bot the speaker is not assigned", () => {
    expect(delegationAllowed(["bot-a"], "bot-a")).toBe(true);
    expect(delegationAllowed(["bot-a"], "bot-b")).toBe(false);
  });

  it("uses the installation credential for a service bot", () => {
    expect(hiveModelSource(true, true)).toBe("installation");
    expect(hiveModelSource(true, false)).toBe("missing");
    expect(hiveModelSource(false, true)).toBe("member");
  });

  it("opens a screen only for that person's running dedicated computer", () => {
    expect(
      dedicatedScreenAllowed({
        callerRole: "USER",
        computerScope: "dedicated",
        slotUserId: "u",
        callerUserId: "u",
        slotState: "running",
      }),
    ).toBe(true);
    expect(
      dedicatedScreenAllowed({
        callerRole: "ADMIN",
        computerScope: "dedicated",
        slotUserId: "u",
        callerUserId: "admin",
        slotState: "running",
      }),
    ).toBe(false);
    expect(
      dedicatedScreenAllowed({
        callerRole: "USER",
        computerScope: "team",
        slotUserId: "u",
        callerUserId: "u",
        slotState: "running",
      }),
    ).toBe(false);
  });

  it("lets CHAT win over READ_ONLY and keeps publication bots out of conversation", () => {
    expect(effectiveAccess([])).toBeNull();
    expect(effectiveAccess(["READ_ONLY"])).toBe("READ_ONLY");
    expect(effectiveAccess(["READ_ONLY", "CHAT"])).toBe("CHAT");
    expect(conversationAllowed({ access: "CHAT", publication: false })).toBe(true);
    expect(conversationAllowed({ access: "CHAT", publication: true })).toBe(false);
    expect(conversationAllowed({ access: "READ_ONLY", publication: false })).toBe(false);
  });

  it("reads the computer cap and idle time from the environment", () => {
    expect(hiveComputerLimits({})).toEqual({ activeLimit: 2, idleMinutes: 30 });
    expect(
      hiveComputerLimits({
        HIVE_MAX_ACTIVE_COMPUTERS: "2",
        HIVE_COMPUTER_IDLE_MINUTES: "30",
      }),
    ).toEqual({ activeLimit: 2, idleMinutes: 30 });
    expect(
      hiveComputerLimits({
        HIVE_MAX_ACTIVE_COMPUTERS: "4",
        HIVE_COMPUTER_IDLE_MINUTES: "15",
      }),
    ).toEqual({ activeLimit: 4, idleMinutes: 15 });
    expect(
      hiveComputerLimits({
        HIVE_MAX_ACTIVE_COMPUTERS: "0",
        HIVE_COMPUTER_IDLE_MINUTES: "nope",
      }),
    ).toEqual({ activeLimit: 2, idleMinutes: 30 });
  });

  it("starts on demand, stops when idle, and queues past the global limit", () => {
    const limit = 1;
    const idleMs = 30 * 60 * 1000;
    const started = requestComputer([], "bot:a", 0, idleMs, limit);
    expect(started.map((slot) => slot.state)).toEqual(["running"]);
    const queued = requestComputer(started, "bot:b", 1_000, idleMs, limit);
    expect(queued.find((slot) => slot.key === "bot:b")?.state).toBe("queued");
    expect(queued.find((slot) => slot.key === "bot:a")?.state).toBe("running");
    const later = requestComputer(queued, "bot:b", idleMs + 1_000, idleMs, limit);
    expect(later.find((slot) => slot.key === "bot:a")?.state).toBe("stopped");
    expect(later.find((slot) => slot.key === "bot:b")?.state).toBe("running");
  });
});
