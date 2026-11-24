import { describe, expect, it } from "vitest";
import { citeKnowledge, embedTexts, KNOWLEDGE_NOT_FOUND } from "./hive-knowledge.js";
import { chunkKnowledgeText, knowledgeFileText } from "./hive-knowledge-text.js";

const vector = Array.from({ length: 768 }, () => 0.01);

describe("knowledge files", () => {
  it("reads text, markdown, a docx paragraph, and a pdf string", () => {
    expect(knowledgeFileText(Buffer.from("# Notes\n\nHello"), "notes.md", false)).toEqual({
      text: "# Notes\n\nHello",
    });
    expect(knowledgeFileText(Buffer.from("plain"), "notes.txt", false)).toEqual({ text: "plain" });
    const xml = "<w:document><w:p><w:t>Desk notes</w:t></w:p></w:document>";
    expect(knowledgeFileText(storedZip("word/document.xml", xml), "notes.docx", false).text).toContain(
      "Desk notes",
    );
    const pdf = Buffer.from(
      "%PDF-1.1\n1 0 obj << /Length 44 >> stream\nBT (Only for Ada) Tj ET\nendstream\n%%EOF",
    );
    expect(knowledgeFileText(pdf, "notes.pdf", false).text).toContain("Only for Ada");
  });

  it("leaves OCR off and rejects an unknown type", () => {
    expect(knowledgeFileText(Buffer.from("scan"), "scan.pdf", true)).toEqual({
      error: "OCR is not configured.",
    });
    expect(knowledgeFileText(Buffer.from("x"), "sheet.xlsx", false)).toEqual({
      error: "This file type is not supported.",
    });
  });

  it("keeps a heading with the chunk", () => {
    const chunks = chunkKnowledgeText("# Policy\n\nThe rule is written here.");
    expect(chunks[0]).toMatchObject({ section: "Policy", page: null });
    expect(chunks[0]?.content).toContain("The rule is written here.");
  });
});

describe("knowledge answers", () => {
  it("cites the document, the place, and the version date", () => {
    expect(
      citeKnowledge([
        {
          title: "Handbook",
          section: "Leave",
          page: null,
          versionAt: "2026-11-24T12:00:00.000Z",
          content: "Ten days.",
        },
      ]),
    ).toBe("Handbook, Leave, 2026-11-24\nTen days.");
  });

  it("says nothing was found and does not name a document", () => {
    const text = citeKnowledge([]);
    expect(text).toBe(KNOWLEDGE_NOT_FOUND);
    expect(text).not.toContain("Handbook");
  });
});

describe("embeddings", () => {
  it("asks the configured model and keeps each vector", async () => {
    const vectors = await embedTexts(["one", "two"], {
      HIVE_LITELLM_BASE_URL: "http://litellm.test",
      HIVE_LITELLM_MASTER_KEY: "test-key",
      HIVE_EMBEDDING_MODEL: "embed-test",
    }, async (url, init) => {
      expect(url).toBe("http://litellm.test/embeddings");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toEqual({ model: "embed-test", input: ["one", "two"] });
      return Response.json({
        data: [
          { index: 1, embedding: vector.map((value) => value + 1) },
          { index: 0, embedding: vector },
        ],
      });
    });
    expect(vectors[0]).toEqual(vector);
    expect(vectors[1]?.[0]).toBeCloseTo(1.01);
  });

  it("refuses a vector of the wrong length", async () => {
    await expect(
      embedTexts(["one"], {
        HIVE_MODEL_BASE_URL: "http://models.test/v1",
        HIVE_MODEL_API_KEY: "test-key",
        HIVE_EMBEDDING_MODEL: "embed-test",
      }, async () => Response.json({ data: [{ index: 0, embedding: [1, 2] }] })),
    ).rejects.toThrow("unexpected vector");
  });
});

function storedZip(name: string, contents: string): Buffer {
  const data = Buffer.from(contents);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  return Buffer.concat([local, nameBytes, data]);
}
