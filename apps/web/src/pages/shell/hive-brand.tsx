// Hive modification: an admin sets the organization's name, colors, and images.
// Derived from Rakazo (Apache License 2.0).

import { Button, Input } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { refreshHiveBrand } from "../../lib/hive-brand";
import type { createSpaceRpc } from "../../lib/rpc";

function fileBody(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function HiveBrandSettings({
  botId,
  rpc,
}: {
  botId: string;
  rpc: ReturnType<typeof createSpaceRpc>;
}) {
  const [name, setName] = useState("");
  const [loginText, setLoginText] = useState("");
  const [primary, setPrimary] = useState("");
  const [accent, setAccent] = useState("");
  const [primaryWarning, setPrimaryWarning] = useState<string | null>(null);
  const [accentWarning, setAccentWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void rpc.hive
      .brand()
      .then((brand) => {
        setName(brand.productName);
        setLoginText(brand.loginText);
        setPrimary(brand.primary ?? "");
        setAccent(brand.accent ?? "");
        setPrimaryWarning(brand.primaryWarning);
        setAccentWarning(brand.accentWarning);
      })
      .catch(() => undefined);
  }, [rpc]);

  async function save() {
    setNotice("");
    const saved = await rpc.hive.saveBrand({ productName: name, loginText, primary, accent });
    setPrimaryWarning(saved.primaryWarning);
    setAccentWarning(saved.accentWarning);
    refreshHiveBrand();
    setNotice("Saved");
  }

  async function upload(slot: "logoLight" | "logoDark" | "favicon" | "bot", file: File | undefined) {
    if (!file) return;
    setNotice("");
    const body = await fileBody(file);
    await rpc.hive.saveBrandFile({
      slot,
      botId: slot === "bot" ? botId : undefined,
      fileName: file.name,
      body,
    });
    refreshHiveBrand();
    setNotice("Saved");
  }

  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="Product name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input aria-label="Login text" value={loginText} onChange={(event) => setLoginText(event.target.value)} />
      <Input aria-label="Primary color" value={primary} onChange={(event) => setPrimary(event.target.value)} />
      {primaryWarning ? <p className="text-xs text-destructive">{primaryWarning}</p> : null}
      <Input aria-label="Accent color" value={accent} onChange={(event) => setAccent(event.target.value)} />
      {accentWarning ? <p className="text-xs text-destructive">{accentWarning}</p> : null}
      <Button type="button" onClick={() => void save().catch(() => setNotice("Could not save"))}>
        Save
      </Button>
      <label className="text-xs">
        Logo
        <input
          aria-label="Logo"
          type="file"
          accept="image/png,image/svg+xml,.ico"
          onChange={(event) => void upload("logoLight", event.target.files?.[0]).catch(() => setNotice("This image is not allowed."))}
        />
      </label>
      <label className="text-xs">
        Dark logo
        <input
          aria-label="Dark logo"
          type="file"
          accept="image/png,image/svg+xml,.ico"
          onChange={(event) => void upload("logoDark", event.target.files?.[0]).catch(() => setNotice("This image is not allowed."))}
        />
      </label>
      <label className="text-xs">
        Favicon
        <input
          aria-label="Favicon"
          type="file"
          accept="image/png,image/svg+xml,.ico"
          onChange={(event) => void upload("favicon", event.target.files?.[0]).catch(() => setNotice("This image is not allowed."))}
        />
      </label>
      <label className="text-xs">
        Avatar
        <input
          aria-label="Avatar"
          type="file"
          accept="image/png,image/svg+xml,.ico"
          onChange={(event) => void upload("bot", event.target.files?.[0]).catch(() => setNotice("This image is not allowed."))}
        />
      </label>
      {notice ? <p className="text-xs">{notice}</p> : null}
    </div>
  );
}
