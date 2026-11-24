import { describe, expect, it } from "vitest";
import {
  hivePasswordAllowed,
  hiveSsoPlacement,
  hiveSsoRevokedUserIds,
  parseHiveGroupMap,
} from "./hive-sso.js";

describe("hive sso", () => {
  it("puts a new verified person in Todos as USER and an admin group as ADMIN", () => {
    const rules = parseHiveGroupMap("finance=USER:Finance\nowners=ADMIN:Owners");
    expect(hiveSsoPlacement({ existingRole: null, groups: [], rules }).role).toBe("USER");
    expect(hiveSsoPlacement({ existingRole: null, groups: [], rules }).departments).toEqual(["Todos"]);
    const admin = hiveSsoPlacement({ existingRole: null, groups: ["owners"], rules });
    expect(admin.role).toBe("ADMIN");
    expect(admin.departments).toEqual(["Todos", "Owners"]);
    expect(hiveSsoPlacement({ existingRole: "SUPER_ADMIN", groups: ["finance"], rules }).role).toBe(
      "SUPER_ADMIN",
    );
  });

  it("keeps password sign-in for the emergency super admin only", () => {
    expect(hivePasswordAllowed("USER", false)).toBe(false);
    expect(hivePasswordAllowed("ADMIN", false)).toBe(false);
    expect(hivePasswordAllowed("SUPER_ADMIN", false)).toBe(true);
    expect(hivePasswordAllowed("USER", true)).toBe(true);
  });

  it("revokes people the IdP no longer lists", () => {
    const gone = hiveSsoRevokedUserIds(
      [
        { subject: "ada", userId: "user-ada" },
        { subject: "bea", userId: "user-bea" },
      ],
      ["ada"],
    );
    expect(gone).toEqual(["user-bea"]);
  });
});
