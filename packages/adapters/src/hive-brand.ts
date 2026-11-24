// Hive modification: the installation brand, overridden by what an admin saves.
// Derived from Rakazo (Apache License 2.0).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HiveBrandRecord, PrismaClient } from "@rakazo/db";
import { readHiveBotAvatars, readHiveBrand } from "@rakazo/db";
import { ensureKnowledgeBucket, knowledgeStorageConfig, openKnowledgeStorage } from "./hive-knowledge.js";

const MAX_BYTES = 512_000;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SVG_BLOCKED = /<script|javascript:|\son[a-z]+\s*=|<foreignObject|<iframe/i;

export interface BrandDefaults {
  productName: string;
  primary: string;
  accent: string;
  loginText: string;
}

export function hiveBrandDefaults(source: Record<string, string | undefined> = process.env): BrandDefaults {
  return {
    productName: source.HIVE_BRAND_NAME?.trim() || "Hive",
    primary: source.HIVE_BRAND_PRIMARY?.trim() ?? "",
    accent: source.HIVE_BRAND_ACCENT?.trim() ?? "",
    loginText: source.HIVE_BRAND_LOGIN_TEXT?.trim() ?? "",
  };
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = linear(Number.parseInt(hex.slice(1, 3), 16));
  const green = linear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = linear(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string): number {
  const left = luminance(a);
  const right = luminance(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function brandColor(hex: string): {
  color: string;
  foreground: string;
  warning: string | null;
} | null {
  if (!HEX.test(hex)) return null;
  const onWhite = contrast(hex, "#ffffff");
  const onBlack = contrast(hex, "#000000");
  const foreground = onWhite >= onBlack ? "#ffffff" : "#000000";
  const readable = Math.max(onWhite, onBlack);
  return {
    color: hex.toLowerCase(),
    foreground,
    warning:
      readable < 4.5
        ? "This color is hard to read."
        : onWhite < 4.5
          ? "White text would be hard to read on this color."
          : null,
  };
}

export function inspectBrandImage(
  fileName: string,
  bytes: Buffer,
): { mime: string; extension: string } | { error: string } {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return { error: "The image is too large." };
  const name = fileName.toLowerCase();
  if (name.endsWith(".svg")) {
    const text = bytes.toString("utf8");
    if (!text.includes("<svg") || SVG_BLOCKED.test(text)) return { error: "This image is not allowed." };
    return { mime: "image/svg+xml", extension: "svg" };
  }
  if (name.endsWith(".png") && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return { mime: "image/png", extension: "png" };
  }
  if (name.endsWith(".ico") && bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) {
    return { mime: "image/x-icon", extension: "ico" };
  }
  return { error: "This image is not allowed." };
}

export function hiveInviteMessage(productName: string, link: string): { subject: string; text: string } {
  const name = productName.trim() || "Hive";
  return {
    subject: `Join ${name}`,
    text: `${name} invited you to sign in.\n${link}`,
  };
}

function chosen(saved: string | null | undefined, fallback: string): string {
  const value = saved?.trim() ?? "";
  return value || fallback;
}

export interface HiveBrandView {
  productName: string;
  loginText: string;
  primary: string | null;
  primaryForeground: string | null;
  primaryWarning: string | null;
  accent: string | null;
  accentForeground: string | null;
  accentWarning: string | null;
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
  avatars: Array<{ botId: string; image: string }>;
}

function paint(saved: string | null | undefined, fallback: string) {
  const parsed = brandColor(chosen(saved, fallback));
  if (!parsed) return { color: null, foreground: null, warning: null };
  return { color: parsed.color, foreground: parsed.foreground, warning: parsed.warning };
}

export function presentHiveBrand(
  record: HiveBrandRecord | null,
  defaults: BrandDefaults,
  files: { logoLight?: string | null; logoDark?: string | null; favicon?: string | null },
  avatars: Array<{ botId: string; image: string }> = [],
): HiveBrandView {
  const primary = paint(record?.primaryColor, defaults.primary);
  const accent = paint(record?.accentColor, defaults.accent);
  return {
    productName: chosen(record?.productName, defaults.productName),
    loginText: chosen(record?.loginText, defaults.loginText),
    primary: primary.color,
    primaryForeground: primary.foreground,
    primaryWarning: primary.warning,
    accent: accent.color,
    accentForeground: accent.foreground,
    accentWarning: accent.warning,
    logoLight: files.logoLight ?? null,
    logoDark: files.logoDark ?? null,
    favicon: files.favicon ?? null,
    avatars,
  };
}

function safeKey(key: string): string {
  if (key.includes("..") || key.startsWith("/") || !key.startsWith("brand/")) {
    throw new Error("This image is not allowed.");
  }
  return key;
}

async function* once(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

export async function writeBrandFile(key: string, bytes: Buffer): Promise<void> {
  const objectKey = safeKey(key);
  const storage = openKnowledgeStorage();
  if (storage) {
    await ensureKnowledgeBucket(storage);
    await storage.put(objectKey, once(bytes));
    return;
  }
  const file = path.join(process.env.DATA_DIR || "data", "hive-brand", objectKey);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export async function readBrandFile(key: string): Promise<Buffer | null> {
  const objectKey = safeKey(key);
  const storage = openKnowledgeStorage();
  if (storage) {
    const chunks: Buffer[] = [];
    try {
      for await (const part of storage.get(objectKey)) chunks.push(Buffer.from(part));
    } catch {
      return null;
    }
    return chunks.length ? Buffer.concat(chunks) : null;
  }
  try {
    return await readFile(path.join(process.env.DATA_DIR || "data", "hive-brand", objectKey));
  } catch {
    return null;
  }
}

function dataUrl(mime: string, bytes: Buffer): string | null {
  if (bytes.length > 200_000) return null;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function mimeFor(key: string): string {
  if (key.endsWith(".svg")) return "image/svg+xml";
  if (key.endsWith(".ico")) return "image/x-icon";
  return "image/png";
}

async function fileUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const bytes = await readBrandFile(key);
  return bytes ? dataUrl(mimeFor(key), bytes) : null;
}

export async function loadHiveBrand(
  prisma: PrismaClient,
  organizationId: string | null,
  includeAvatars: boolean,
): Promise<HiveBrandView> {
  const defaults = hiveBrandDefaults();
  if (!organizationId) return presentHiveBrand(null, defaults, {});
  const record = await readHiveBrand(prisma, organizationId);
  const [logoLight, logoDark, favicon, rows] = await Promise.all([
    fileUrl(record?.logoLightKey),
    fileUrl(record?.logoDarkKey),
    fileUrl(record?.faviconKey),
    includeAvatars ? readHiveBotAvatars(prisma, organizationId) : Promise.resolve([]),
  ]);
  const avatars: Array<{ botId: string; image: string }> = [];
  for (const row of rows) {
    const image = await fileUrl(row.objectKey);
    if (image) avatars.push({ botId: row.botId, image });
  }
  return presentHiveBrand(record, defaults, { logoLight, logoDark, favicon }, avatars);
}

export function brandObjectKey(organizationId: string, slot: string, extension: string): string {
  return `brand/${organizationId}/${slot}.${extension}`;
}
