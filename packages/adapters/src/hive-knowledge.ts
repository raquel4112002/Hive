// Hive modification: embeddings, object storage, and the knowledge search tool.
// Derived from Rakazo (Apache License 2.0).

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
  HIVE_EMBEDDING_DIMENSIONS,
  beginHiveDocument,
  finishHiveDocument,
  hiveKnowledgeAudience,
  hiveServiceKnowledgeRun,
  readHiveDocumentObject,
  removeHiveDocument,
  replaceHiveChunks,
  searchHiveKnowledge,
} from "@rakazo/db";
import type { KnowledgeChunkInput, KnowledgeGrant, KnowledgeHit, PrismaClient } from "@rakazo/db";
import { S3ObjectStorage } from "./s3-object-storage.js";
import type { S3ObjectStorageConfig } from "./s3-object-storage.js";
import { chunkKnowledgeText, knowledgeFileText } from "./hive-knowledge-text.js";

export const KNOWLEDGE_NOT_FOUND = "I did not find that in the documents I can read.";

export function citeKnowledge(hits: readonly KnowledgeHit[]): string {
  if (hits.length === 0) return KNOWLEDGE_NOT_FOUND;
  return hits
    .map((hit) => {
      const where = hit.section || (hit.page ? `page ${hit.page}` : "document");
      return `${hit.title}, ${where}, ${hit.versionAt.slice(0, 10)}\n${hit.content.slice(0, 500)}`;
    })
    .join("\n\n");
}

export function knowledgeStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): S3ObjectStorageConfig | undefined {
  const bucket = env.HIVE_KNOWLEDGE_BUCKET?.trim();
  const endpoint = env.HIVE_KNOWLEDGE_ENDPOINT?.trim();
  const accessKeyId = env.HIVE_KNOWLEDGE_ACCESS_KEY?.trim();
  const secretAccessKey = env.HIVE_KNOWLEDGE_SECRET_KEY?.trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return undefined;
  return {
    bucket,
    endpoint,
    region: "us-east-1",
    accessKeyId,
    secretAccessKey,
    prefix: "",
    pathStyle: true,
  };
}

export async function openKnowledgeStorage(
  env: NodeJS.ProcessEnv = process.env,
): Promise<S3ObjectStorage | undefined> {
  const config = knowledgeStorageConfig(env);
  if (!config) return undefined;
  await ensureKnowledgeBucket(config);
  return new S3ObjectStorage(config);
}

export async function ensureKnowledgeBucket(config: S3ObjectStorageConfig): Promise<void> {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.pathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch(() => undefined);
}

export async function embedTexts(
  texts: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  const model = env.HIVE_EMBEDDING_MODEL?.trim();
  const litellm = env.HIVE_LITELLM_BASE_URL?.trim();
  const base = (litellm || env.HIVE_MODEL_BASE_URL?.trim() || "").replace(/\/$/, "");
  const key = (litellm ? env.HIVE_LITELLM_MASTER_KEY : env.HIVE_MODEL_API_KEY)?.trim() ?? "";
  if (!model || !base) throw new Error("Connect an embedding model.");
  const response = await fetchImpl(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ model, input: [...texts] }),
  });
  if (!response.ok) throw new Error("Connect an embedding model.");
  const body = (await response.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
  const ordered = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (ordered.length !== texts.length) throw new Error("The embedding model returned an unexpected vector.");
  return ordered.map((row) => {
    const embedding = row.embedding ?? [];
    if (embedding.length !== HIVE_EMBEDDING_DIMENSIONS) {
      throw new Error("The embedding model returned an unexpected vector.");
    }
    return embedding;
  });
}

async function bytesOf(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

export async function ingestHiveDocument(
  prisma: PrismaClient,
  storage: S3ObjectStorage,
  input: {
    organizationId: string;
    collectionId: string;
    title: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    actorUserId: string;
    grants: KnowledgeGrant[];
    ocr?: boolean;
    documentId?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<{ id: string; status: string; error: string | null }> {
  const started = await beginHiveDocument(prisma, {
    organizationId: input.organizationId,
    collectionId: input.collectionId,
    title: input.title,
    mimeType: input.mimeType,
    actorUserId: input.actorUserId,
    ocr: input.ocr === true,
    grants: input.grants,
    documentId: input.documentId,
  });
  if (!started) return { id: input.documentId ?? "", status: "failed", error: "The collection was not found." };
  const fail = async (error: string) => {
    await finishHiveDocument(prisma, { id: started.id, status: "failed", error });
    return { id: started.id, status: "failed" as const, error };
  };
  try {
    await storage.put(started.objectKey, [input.bytes]);
    const extracted = knowledgeFileText(input.bytes, input.fileName, input.ocr === true);
    if ("error" in extracted) return fail(extracted.error);
    const pieces = chunkKnowledgeText(extracted.text);
    if (pieces.length === 0) return fail("This file has no text.");
    const vectors = await embedTexts(
      pieces.map((piece) => piece.content),
      input.env,
      input.fetchImpl,
    );
    const chunks: KnowledgeChunkInput[] = pieces.map((piece, index) => ({
      ...piece,
      embedding: vectors[index] ?? [],
    }));
    await replaceHiveChunks(prisma, {
      documentId: started.id,
      organizationId: input.organizationId,
      chunks,
    });
    await finishHiveDocument(prisma, { id: started.id, status: "ready", error: null });
    return { id: started.id, status: "ready", error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The document could not be processed.";
    return fail(message);
  }
}

export async function reprocessHiveDocument(
  prisma: PrismaClient,
  storage: S3ObjectStorage,
  input: {
    organizationId: string;
    documentId: string;
    actorUserId: string;
    grants: KnowledgeGrant[];
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<{ id: string; status: string; error: string | null }> {
  const existing = await readHiveDocumentObject(prisma, input);
  if (!existing) return { id: input.documentId, status: "failed", error: "The document was not found." };
  const bytes = await bytesOf(storage.get(existing.objectKey));
  const fileName = existing.mimeType === "application/pdf"
    ? "file.pdf"
    : existing.mimeType.includes("wordprocessingml")
      ? "file.docx"
      : existing.mimeType === "text/markdown"
        ? "file.md"
        : "file.txt";
  return ingestHiveDocument(prisma, storage, {
    organizationId: input.organizationId,
    collectionId: existing.collectionId,
    title: existing.title,
    fileName,
    mimeType: existing.mimeType,
    bytes,
    actorUserId: input.actorUserId,
    grants: input.grants,
    ocr: false,
    documentId: input.documentId,
    env: input.env,
    fetchImpl: input.fetchImpl,
  });
}

export async function deleteHiveDocument(
  prisma: PrismaClient,
  storage: S3ObjectStorage | undefined,
  input: { organizationId: string; documentId: string },
): Promise<void> {
  const objectKey = await removeHiveDocument(prisma, input);
  if (objectKey && storage) await storage.delete([objectKey]).catch(() => undefined);
}

/** Sources for one turn. Empty when the bot has no collection. The text is already filtered in SQL. */
export async function knowledgeForTurn(
  prisma: PrismaClient,
  input: {
    botId: string;
    botUserId: string;
    runUserId: string;
    routineId?: string | null;
    query: string;
  },
): Promise<string | undefined> {
  if (!input.query.trim()) return undefined;
  const linked = await prisma.hiveCollectionBot.findFirst({
    where: { botId: input.botId },
    select: { botId: true },
  });
  if (!linked) return undefined;
  try {
    return await runKnowledgeSearch(prisma, input);
  } catch {
    return undefined;
  }
}

export async function runKnowledgeSearch(
  prisma: PrismaClient,
  input: {
    botId: string;
    botUserId: string;
    runUserId: string;
    routineId?: string | null;
    query: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<string> {
  const query = input.query.trim();
  if (!query) return KNOWLEDGE_NOT_FOUND;
  const [embedding] = await embedTexts([query], input.env, input.fetchImpl);
  const service = await hiveServiceKnowledgeRun(prisma, {
    botUserId: input.botUserId,
    runUserId: input.runUserId,
  });
  const audienceUserIds = service
    ? await hiveKnowledgeAudience(prisma, { botId: input.botId, routineId: input.routineId })
    : undefined;
  const hits = await searchHiveKnowledge(prisma, {
    botId: input.botId,
    userId: input.runUserId,
    embedding: embedding ?? [],
    audienceUserIds,
  });
  return citeKnowledge(hits);
}
