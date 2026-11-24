import { describe, expect, it } from "vitest";
import {
  brandColor,
  hiveBrandDefaults,
  hiveInviteMessage,
  inspectBrandImage,
  presentHiveBrand,
} from "./hive-brand.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

describe("hive brand", () => {
  it("keeps each organization's name and colors to itself", () => {
    const defaults = hiveBrandDefaults({ HIVE_BRAND_NAME: "Hive" });
    const north = presentHiveBrand(
      {
        organizationId: "north",
        productName: "Northwind",
        logoLightKey: null,
        logoDarkKey: null,
        faviconKey: null,
        primaryColor: "#0b3d91",
        accentColor: null,
        loginText: "Welcome to Northwind",
      },
      defaults,
      {},
    );
    const south = presentHiveBrand(
      {
        organizationId: "south",
        productName: "Southbay",
        logoLightKey: null,
        logoDarkKey: null,
        faviconKey: null,
        primaryColor: "#7a1f1f",
        accentColor: null,
        loginText: "Welcome to Southbay",
      },
      defaults,
      {},
    );
    expect(north.productName).toBe("Northwind");
    expect(north.loginText).toBe("Welcome to Northwind");
    expect(JSON.stringify(north)).not.toContain("Southbay");
    expect(JSON.stringify(south)).not.toContain("Northwind");
  });

  it("lets a saved name replace the installation default", () => {
    const shown = presentHiveBrand(
      {
        organizationId: "one",
        productName: "",
        logoLightKey: null,
        logoDarkKey: null,
        faviconKey: null,
        primaryColor: null,
        accentColor: null,
        loginText: null,
      },
      hiveBrandDefaults({ HIVE_BRAND_NAME: "Harbor" }),
      {},
    );
    expect(shown.productName).toBe("Harbor");
  });

  it("writes a different invite for each organization", () => {
    const north = hiveInviteMessage("Northwind", "https://hive.example/sign-up?invite=north");
    const south = hiveInviteMessage("Southbay", "https://hive.example/sign-up?invite=south");
    expect(north.subject).toBe("Join Northwind");
    expect(north.text).toContain("Northwind");
    expect(north.text).not.toContain("Southbay");
    expect(north.text).not.toContain("Rakazo");
    expect(south.text).toContain("Southbay");
    expect(south.text).not.toContain("Northwind");
  });

  it("rejects an SVG that contains a script", () => {
    const dirty = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(inspectBrandImage("logo.svg", dirty)).toEqual({ error: "This image is not allowed." });
    const clean = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(inspectBrandImage("logo.svg", clean)).toEqual({ mime: "image/svg+xml", extension: "svg" });
    expect(inspectBrandImage("logo.png", png)).toEqual({ mime: "image/png", extension: "png" });
  });

  it("picks readable text and warns when white text would fail", () => {
    expect(brandColor("#0b3d91")?.warning).toBeNull();
    expect(brandColor("#0b3d91")?.foreground).toBe("#ffffff");
    expect(brandColor("#dddddd")?.foreground).toBe("#000000");
    expect(brandColor("#dddddd")?.warning).toBe("White text would be hard to read on this color.");
  });
});
