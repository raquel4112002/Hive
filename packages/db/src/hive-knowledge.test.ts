import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { HIVE_EMBEDDING_DIMENSIONS, searchHiveKnowledge } from "./hive-knowledge.js";

describe("knowledge search", () => {
  it("asks SQL as the person who is talking and returns those rows unchanged", async () => {
    const seen: unknown[] = [];
    const prisma = fake((query, values) => {
      seen.push([query.join(" "), values]);
      return [
        {
          title: "Visible",
          section: "Start",
          page: 2,
          versionAt: new Date("2026-11-24T00:00:00.000Z"),
          content: "hello",
        },
      ];
    });
    const hits = await searchHiveKnowledge(prisma, {
      botId: "bot-1",
      userId: "person-b",
      embedding: Array.from({ length: HIVE_EMBEDDING_DIMENSIONS }, () => 0),
    });
    expect(hits).toEqual([
      {
        title: "Visible",
        section: "Start",
        page: 2,
        versionAt: "2026-11-24T00:00:00.000Z",
        content: "hello",
      },
    ]);
    const settings = seen[0] as [string, unknown[]];
    expect(settings[0]).toContain("app.user_id");
    expect(settings[0]).toContain("app.knowledge_mode");
    expect(settings[1]).toContain("person-b");
    expect(settings[1]).toContain("person");
  });

  it("uses the publication audience in the session and still returns the SQL rows", async () => {
    const seen: unknown[][] = [];
    const prisma = fake((query, values) => {
      seen.push(values);
      return query.join(" ").includes("ORDER BY")
        ? [
            {
              title: "Shared",
              section: "",
              page: null,
              versionAt: new Date("2026-11-01T00:00:00.000Z"),
              content: "everyone",
            },
          ]
        : [];
    });
    const hits = await searchHiveKnowledge(prisma, {
      botId: "bot-1",
      userId: "service",
      embedding: Array.from({ length: HIVE_EMBEDDING_DIMENSIONS }, () => 0.2),
      audienceUserIds: ["person-a", "person-b"],
    });
    expect(seen[0]).toContain("audience");
    expect(seen[0]).toContain("person-a,person-b");
    expect(hits.map((hit) => hit.title)).toEqual(["Shared"]);
  });
});

function fake(
  onQuery: (query: TemplateStringsArray, values: unknown[]) => unknown[],
): PrismaClient {
  return {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $executeRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
          onQuery(query, values);
        },
        $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => onQuery(query, values),
      }),
  } as unknown as PrismaClient;
}
