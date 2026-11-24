// Hive modification: knowledge metadata and the permissioned search query.
// Derived from Rakazo (Apache License 2.0).

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

export const HIVE_EMBEDDING_DIMENSIONS = 768;

export type KnowledgeGrantKind = "organization" | "department" | "person";

export interface KnowledgeGrant {
  kind: KnowledgeGrantKind;
  subjectId: string;
}

export interface KnowledgeHit {
  title: string;
  section: string;
  page: number | null;
  versionAt: string;
  content: string;
}

export interface KnowledgeChunkInput {
  section: string;
  page: number | null;
  content: string;
  embedding: number[];
}

const KINDS = new Set<KnowledgeGrantKind>(["organization", "department", "person"]);

function grantsOf(rows: Array<{ kind: string; subjectId: string }>): KnowledgeGrant[] {
  return rows.flatMap((row) =>
    KINDS.has(row.kind as KnowledgeGrantKind)
      ? [{ kind: row.kind as KnowledgeGrantKind, subjectId: row.subjectId }]
      : [],
  );
}

export async function createHiveCollection(
  prisma: PrismaClient,
  input: { organizationId: string; name: string; actorUserId: string },
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  await runAsSystem("create hive collection", () =>
    prisma.hiveKnowledgeCollection.create({
      data: {
        id,
        organizationId: input.organizationId,
        name: input.name,
        createdByUserId: input.actorUserId,
      },
    }),
  );
  return { id, name: input.name };
}

export async function linkHiveCollection(
  prisma: PrismaClient,
  input: { organizationId: string; collectionId: string; botId: string },
): Promise<void> {
  await runAsSystem("link hive collection", async () => {
    const collection = await prisma.hiveKnowledgeCollection.findFirst({
      where: { id: input.collectionId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!collection) return;
    await prisma.hiveCollectionBot.upsert({
      where: { collectionId_botId: { collectionId: input.collectionId, botId: input.botId } },
      create: { collectionId: input.collectionId, botId: input.botId },
      update: {},
    });
  });
}

export async function listHiveCollections(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Array<{ id: string; name: string; botIds: string[] }>> {
  return runAsSystem("list hive collections", async () => {
    const collections = await prisma.hiveKnowledgeCollection.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const links = collections.length
      ? await prisma.hiveCollectionBot.findMany({
          where: { collectionId: { in: collections.map((row) => row.id) } },
          select: { collectionId: true, botId: true },
        })
      : [];
    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      botIds: links.filter((link) => link.collectionId === collection.id).map((link) => link.botId),
    }));
  });
}

export async function listHiveDocuments(
  prisma: PrismaClient,
  input: { organizationId: string; collectionId: string },
): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    error: string | null;
    versionAt: string | null;
    grants: KnowledgeGrant[];
  }>
> {
  return runAsSystem("list hive documents", async () => {
    const documents = await prisma.hiveKnowledgeDocument.findMany({
      where: { organizationId: input.organizationId, collectionId: input.collectionId },
      select: { id: true, title: true, status: true, error: true, versionAt: true },
      orderBy: { title: "asc" },
    });
    const grants = documents.length
      ? await prisma.hiveKnowledgeAcl.findMany({
          where: { documentId: { in: documents.map((row) => row.id) }, chunkId: null },
          select: { documentId: true, kind: true, subjectId: true },
        })
      : [];
    return documents.map((document) => ({
      id: document.id,
      title: document.title,
      status: document.status,
      error: document.error,
      versionAt: document.versionAt?.toISOString() ?? null,
      grants: grantsOf(grants.filter((grant) => grant.documentId === document.id)),
    }));
  });
}

export async function beginHiveDocument(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    collectionId: string;
    title: string;
    mimeType: string;
    actorUserId: string;
    ocr: boolean;
    grants: KnowledgeGrant[];
    documentId?: string;
  },
): Promise<{ id: string; objectKey: string } | null> {
  return runAsSystem("begin hive document", async () => {
    const collection = await prisma.hiveKnowledgeCollection.findFirst({
      where: { id: input.collectionId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!collection) return null;
    const id = input.documentId ?? randomUUID();
    const existing = input.documentId
      ? await prisma.hiveKnowledgeDocument.findFirst({
          where: { id, organizationId: input.organizationId, collectionId: input.collectionId },
          select: { objectKey: true },
        })
      : null;
    if (input.documentId && !existing) return null;
    const objectKey = existing?.objectKey ?? `knowledge/${input.organizationId}/${id}`;
    await prisma.hiveKnowledgeDocument.upsert({
      where: { id },
      create: {
        id,
        organizationId: input.organizationId,
        collectionId: input.collectionId,
        title: input.title,
        objectKey,
        mimeType: input.mimeType,
        status: "processing",
        error: null,
        ocr: input.ocr,
        createdByUserId: input.actorUserId,
        updatedAt: new Date(),
      },
      update: {
        title: input.title,
        mimeType: input.mimeType,
        status: "processing",
        error: null,
        ocr: input.ocr,
        updatedAt: new Date(),
      },
    });
    await prisma.hiveKnowledgeAcl.deleteMany({ where: { documentId: id, chunkId: null } });
    if (input.grants.length) {
      await prisma.hiveKnowledgeAcl.createMany({
        data: input.grants.map((grant) => ({
          id: randomUUID(),
          documentId: id,
          chunkId: null,
          kind: grant.kind,
          subjectId: grant.subjectId,
        })),
      });
    }
    return { id, objectKey };
  });
}

export async function finishHiveDocument(
  prisma: PrismaClient,
  input: { id: string; status: "ready" | "failed" | "needs_ocr"; error: string | null },
): Promise<void> {
  await runAsSystem("finish hive document", () =>
    prisma.hiveKnowledgeDocument.update({
      where: { id: input.id },
      data: {
        status: input.status,
        error: input.error,
        versionAt: input.status === "ready" ? new Date() : undefined,
        updatedAt: new Date(),
      },
    }),
  );
}

export async function replaceHiveChunks(
  prisma: PrismaClient,
  input: { documentId: string; organizationId: string; chunks: KnowledgeChunkInput[] },
): Promise<void> {
  await runAsSystem("replace hive chunks", async () => {
    const grants = await prisma.hiveKnowledgeAcl.findMany({
      where: { documentId: input.documentId, chunkId: null },
      select: { kind: true, subjectId: true },
    });
    const document = await prisma.hiveKnowledgeDocument.findFirst({
      where: { id: input.documentId },
      select: { versionAt: true },
    });
    await prisma.hiveKnowledgeChunk.deleteMany({ where: { documentId: input.documentId } });
    const versionAt = document?.versionAt ?? new Date();
    for (let ordinal = 0; ordinal < input.chunks.length; ordinal += 1) {
      const chunk = input.chunks[ordinal]!;
      if (chunk.embedding.length !== HIVE_EMBEDDING_DIMENSIONS) continue;
      const id = randomUUID();
      const vector = `[${chunk.embedding.join(",")}]`;
      await prisma.$executeRaw`
        INSERT INTO "hive_knowledge_chunks"
          ("id", "documentId", "organizationId", "ordinal", "section", "page", "content", "embedding", "versionAt")
        VALUES
          (${id}, ${input.documentId}, ${input.organizationId}, ${ordinal}, ${chunk.section}, ${chunk.page}, ${chunk.content}, ${vector}::vector, ${versionAt})
      `;
      if (grants.length) {
        await prisma.hiveKnowledgeAcl.createMany({
          data: grants.map((grant) => ({
            id: randomUUID(),
            documentId: input.documentId,
            chunkId: id,
            kind: grant.kind,
            subjectId: grant.subjectId,
          })),
        });
      }
    }
  });
}

export async function removeHiveDocument(
  prisma: PrismaClient,
  input: { organizationId: string; documentId: string },
): Promise<string | null> {
  return runAsSystem("remove hive document", async () => {
    const document = await prisma.hiveKnowledgeDocument.findFirst({
      where: { id: input.documentId, organizationId: input.organizationId },
      select: { objectKey: true },
    });
    if (!document) return null;
    await prisma.hiveKnowledgeDocument.delete({ where: { id: input.documentId } });
    return document.objectKey;
  });
}

export async function readHiveDocumentObject(
  prisma: PrismaClient,
  input: { organizationId: string; documentId: string },
): Promise<{ objectKey: string; title: string; mimeType: string; collectionId: string } | null> {
  return runAsSystem("read hive document object", () =>
    prisma.hiveKnowledgeDocument.findFirst({
      where: { id: input.documentId, organizationId: input.organizationId },
      select: { objectKey: true, title: true, mimeType: true, collectionId: true },
    }),
  );
}

/** True when this run is the bot's service account, so search uses the publication audience. */
export async function hiveServiceKnowledgeRun(
  prisma: PrismaClient,
  input: { botUserId: string; runUserId: string },
): Promise<boolean> {
  if (input.botUserId !== input.runUserId) return false;
  const user = await runAsSystem("hive service knowledge", () =>
    prisma.user.findUnique({ where: { id: input.botUserId }, select: { hiveService: true } }),
  );
  return user?.hiveService === true;
}

/** People who will receive a service-account routine or publication. */
export async function hiveKnowledgeAudience(
  prisma: PrismaClient,
  input: { botId: string; routineId?: string | null },
): Promise<string[]> {
  return runAsSystem("hive knowledge audience", async () => {
    const assigned = await prisma.botDepartmentAssignment.findMany({
      where: { botId: input.botId },
      select: { departmentId: true },
    });
    const departmentIds = new Set(assigned.map((row) => row.departmentId));
    const direct: string[] = [];
    if (input.routineId) {
      const recipients = await prisma.routineRecipient.findMany({
        where: { routineId: input.routineId },
        select: { userId: true, departmentId: true },
      });
      for (const recipient of recipients) {
        if (recipient.userId) direct.push(recipient.userId);
        if (recipient.departmentId) departmentIds.add(recipient.departmentId);
      }
    }
    const members = departmentIds.size
      ? await prisma.departmentMember.findMany({
          where: { departmentId: { in: [...departmentIds] } },
          select: { userId: true },
        })
      : [];
    return [...new Set([...direct, ...members.map((row) => row.userId)])];
  });
}

/**
 * Nearest chunks for one bot. Row security hides anything the session cannot read.
 * The returned rows are the query result, with no second pass over titles or text.
 */
export async function searchHiveKnowledge(
  prisma: PrismaClient,
  input: {
    botId: string;
    userId: string;
    embedding: number[];
    audienceUserIds?: string[];
  },
): Promise<KnowledgeHit[]> {
  if (input.embedding.length !== HIVE_EMBEDDING_DIMENSIONS) return [];
  if (input.embedding.some((value) => !Number.isFinite(value))) return [];
  const mode = input.audienceUserIds ? "audience" : "person";
  const audience = input.audienceUserIds?.join(",") ?? "";
  const vector = `[${input.embedding.join(",")}]`;
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.rls_bypass', 'off', true),
        set_config('app.user_id', ${input.userId}, true),
        set_config('app.knowledge_mode', ${mode}, true),
        set_config('app.knowledge_audience', ${audience}, true)
    `;
    return tx.$queryRaw<
      Array<{
        title: string;
        section: string;
        page: number | null;
        versionAt: Date;
        content: string;
      }>
    >`
      SELECT d."title", c."section", c."page", d."versionAt", c."content"
      FROM "hive_knowledge_chunks" c
      JOIN "hive_knowledge_documents" d ON d."id" = c."documentId"
      JOIN "hive_collection_bots" b ON b."collectionId" = d."collectionId"
      WHERE b."botId" = ${input.botId} AND d."status" = 'ready' AND d."versionAt" IS NOT NULL
      ORDER BY c."embedding" <=> ${vector}::vector
      LIMIT 8
    `;
  });
  return rows.map((row) => ({
    title: row.title,
    section: row.section,
    page: row.page,
    versionAt: row.versionAt.toISOString(),
    content: row.content,
  }));
}
