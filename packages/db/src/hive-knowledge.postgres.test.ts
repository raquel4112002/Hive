import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import {
  beginHiveDocument,
  createHiveCollection,
  finishHiveDocument,
  hiveKnowledgeAudience,
  linkHiveCollection,
  replaceHiveChunks,
  searchHiveKnowledge,
} from "./hive-knowledge.js";
import { runAsSystem } from "./row-security.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(url);
const describePostgres = enabled ? describe : describe.skip;

describePostgres("knowledge permissions", () => {
  const db = createDb(url ?? "postgres://unused", { applicationName: "hive-knowledge" });
  const org = "k5-org";
  const ada = "k5-ada";
  const bea = "k5-bea";
  const bot = "k5-bot";
  const department = "k5-dept";
  const embedding = Array.from({ length: 768 }, () => 0.25);
  let documentId = "";

  afterAll(async () => {
    await runAsSystem("cleanup knowledge proof", async () => {
      await db.prisma.hiveKnowledgeDocument.deleteMany({ where: { organizationId: org } });
      await db.prisma.hiveCollectionBot.deleteMany({ where: { botId: bot } });
      await db.prisma.hiveKnowledgeCollection.deleteMany({ where: { organizationId: org } });
      await db.prisma.departmentMember.deleteMany({ where: { departmentId: department } });
      await db.prisma.department.deleteMany({ where: { id: department } });
      await db.prisma.hiveRole.deleteMany({ where: { organizationId: org } });
    }).catch(() => undefined);
    await db.pool.end();
  });

  it("hides one person's document from the other, including a direct lookup", async () => {
    const [session] = await db.prisma.$queryRaw<
      Array<{ user: string; bypass: boolean; forced: boolean }>
    >`
      SELECT current_user AS "user",
        EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
        ) AS bypass,
        (
          SELECT bool_and(c.relforcerowsecurity)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('hive_knowledge_documents', 'hive_knowledge_chunks')
        ) AS forced
    `;
    expect(session?.user).toBe(new URL(url ?? "").username);
    expect(session?.bypass).toBe(false);
    expect(session?.forced).toBe(true);
    await runAsSystem("seed knowledge people", async () => {
      await db.prisma.hiveRole.createMany({
        data: [
          { id: "k5-role-ada", organizationId: org, userId: ada, role: "USER" },
          { id: "k5-role-bea", organizationId: org, userId: bea, role: "USER" },
        ],
      });
      await db.prisma.department.create({
        data: { id: department, organizationId: org, name: "K5", createdByUserId: ada, system: true },
      });
    });
    const collection = await createHiveCollection(db.prisma, {
      organizationId: org,
      name: "Notes",
      actorUserId: ada,
    });
    await linkHiveCollection(db.prisma, { organizationId: org, collectionId: collection.id, botId: bot });
    const started = await beginHiveDocument(db.prisma, {
      organizationId: org,
      collectionId: collection.id,
      title: "Ada only",
      mimeType: "text/plain",
      actorUserId: ada,
      ocr: false,
      grants: [{ kind: "person", subjectId: ada }],
    });
    documentId = started?.id ?? "";
    await replaceHiveChunks(db.prisma, {
      documentId,
      organizationId: org,
      chunks: [{ section: "Secret", page: 1, content: "only ada", embedding }],
    });
    await finishHiveDocument(db.prisma, { id: documentId, status: "ready", error: null });

    const asAda = await searchHiveKnowledge(db.prisma, { botId: bot, userId: ada, embedding });
    const asBea = await searchHiveKnowledge(db.prisma, { botId: bot, userId: bea, embedding });
    expect(asAda.map((hit) => hit.title)).toEqual(["Ada only"]);
    expect(asAda[0]).toMatchObject({ section: "Secret", page: 1 });
    expect(asBea).toEqual([]);

    await runAsSystem("department grant", async () => {
      const chunk = await db.prisma.hiveKnowledgeChunk.findFirst({
        where: { documentId },
        select: { id: true },
      });
      if (!chunk) throw new Error("missing chunk");
      await db.prisma.hiveKnowledgeAcl.deleteMany({ where: { documentId } });
      await db.prisma.hiveKnowledgeAcl.createMany({
        data: [
          { id: "k5-acl-doc", documentId, chunkId: null, kind: "department", subjectId: department },
          { id: "k5-acl-chunk", documentId, chunkId: chunk.id, kind: "department", subjectId: department },
        ],
      });
      await db.prisma.departmentMember.create({
        data: { id: "k5-member-bea", departmentId: department, userId: bea },
      });
    });
    expect((await searchHiveKnowledge(db.prisma, { botId: bot, userId: bea, embedding })).length).toBe(1);
    await runAsSystem("remove member", () =>
      db.prisma.departmentMember.deleteMany({ where: { departmentId: department, userId: bea } }),
    );
    expect(await searchHiveKnowledge(db.prisma, { botId: bot, userId: bea, embedding })).toEqual([]);

    const blocked = await searchHiveKnowledge(db.prisma, {
      botId: bot,
      userId: "k5-service",
      embedding,
      audienceUserIds: [ada, bea],
    });
    expect(blocked).toEqual([]);

    await runAsSystem("organization grant", async () => {
      const chunk = await db.prisma.hiveKnowledgeChunk.findFirst({
        where: { documentId },
        select: { id: true },
      });
      if (!chunk) throw new Error("missing chunk");
      await db.prisma.hiveKnowledgeAcl.deleteMany({ where: { documentId } });
      await db.prisma.hiveKnowledgeAcl.createMany({
        data: [
          { id: "k5-acl-org", documentId, chunkId: null, kind: "organization", subjectId: org },
          { id: "k5-acl-org-chunk", documentId, chunkId: chunk.id, kind: "organization", subjectId: org },
        ],
      });
    });
    const shared = await searchHiveKnowledge(db.prisma, {
      botId: bot,
      userId: "k5-service",
      embedding,
      audienceUserIds: [ada, bea],
    });
    expect(shared.map((hit) => hit.title)).toEqual(["Ada only"]);
    expect(await hiveKnowledgeAudience(db.prisma, { botId: bot })).toEqual([]);
  });
});
