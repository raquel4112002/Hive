// Hive modification: turn an uploaded file into text. OCR stays off.
// Derived from Rakazo (Apache License 2.0).

import { inflateRawSync } from "node:zlib";

export interface KnowledgePiece {
  section: string;
  page: number | null;
  content: string;
}

const CHUNK = 800;

export function knowledgeFileText(
  bytes: Buffer,
  fileName: string,
  ocr: boolean,
): { text: string } | { error: string } {
  if (ocr) return { error: "OCR is not configured." };
  const name = fileName.toLowerCase();
  const text = name.endsWith(".txt") || name.endsWith(".md")
    ? bytes.toString("utf8")
    : name.endsWith(".docx")
      ? docxText(bytes)
      : name.endsWith(".pdf")
        ? pdfText(bytes)
        : null;
  if (text === null) return { error: "This file type is not supported." };
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (!cleaned) return { error: "This file has no text." };
  return { text: cleaned };
}

export function chunkKnowledgeText(text: string): KnowledgePiece[] {
  const pages = text.split("\f");
  const chunks: KnowledgePiece[] = [];
  pages.forEach((pageText, index) => {
    const page = pages.length > 1 ? index + 1 : null;
    let section = "";
    let current = "";
    const push = () => {
      const content = current.trim();
      if (content) chunks.push({ section, page, content });
      current = "";
    };
    for (const block of pageText.split(/\n{2,}/)) {
      const heading = block.match(/^#{1,3} (.+)$/m);
      if (heading?.[1]) section = heading[1].trim();
      const piece = block.trim();
      if (!piece) continue;
      const parts = piece.length > CHUNK ? piece.match(new RegExp(`.{1,${CHUNK}}`, "gs")) ?? [] : [piece];
      for (const part of parts) {
        if (current && current.length + part.length + 2 > CHUNK) push();
        current = current ? `${current}\n\n${part}` : part;
      }
    }
    push();
  });
  return chunks;
}

function docxText(bytes: Buffer): string {
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) return "";
  return xml
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function pdfText(bytes: Buffer): string {
  const decoded: Buffer[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const start = bytes.indexOf("stream", cursor);
    if (start < 0) break;
    let dataStart = start + "stream".length;
    if (bytes[dataStart] === 13) dataStart += 1;
    if (bytes[dataStart] === 10) dataStart += 1;
    const end = bytes.indexOf("endstream", dataStart);
    if (end < 0) break;
    const raw = bytes.subarray(dataStart, end);
    try {
      decoded.push(inflateRawSync(raw));
    } catch {
      decoded.push(raw);
    }
    cursor = end + "endstream".length;
  }
  const blob = (decoded.length ? Buffer.concat(decoded) : bytes).toString("latin1");
  return [...blob.matchAll(/\((?:\\.|[^\\)])*\)/g)]
    .map((match) =>
      match[0]
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\"),
    )
    .join(" ");
}

function zipEntry(bytes: Buffer, name: string): string | null {
  let cursor = 0;
  while (cursor + 30 < bytes.length) {
    if (bytes.readUInt32LE(cursor) !== 0x04034b50) {
      cursor += 1;
      continue;
    }
    const method = bytes.readUInt16LE(cursor + 8);
    const compressed = bytes.readUInt32LE(cursor + 18);
    const nameLength = bytes.readUInt16LE(cursor + 26);
    const extraLength = bytes.readUInt16LE(cursor + 28);
    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const entryName = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = bytes.subarray(dataStart, dataStart + compressed);
    if (entryName === name) {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      return null;
    }
    cursor = dataStart + compressed;
  }
  return null;
}
