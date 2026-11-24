// Hive modification: organization connections and conversation inspect.
// Derived from Rakazo (Apache License 2.0).

import { statfsSync } from "node:fs";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { ORPCError } from "@orpc/server";
import { brandColor, brandObjectKey, createLiteLLM, deleteHiveDocument, hiveBrandDefaults, hiveInviteMessage, hiveLiteLLM, ingestHiveDocument, inspectBrandImage, issueBotModelKey, listBotSpend, loadHiveBrand, openKnowledgeStorage, reprocessHiveDocument, vaultHealth, writeBrandFile, writeHiveCredential } from "@rakazo/adapters";
import {
  assignBotDepartment,
  createHiveCollection,
  createHiveInvite,
  ensureEveryoneDepartment,
  inspectConversation,
  linkBotConnection,
  linkHiveCollection,
  listBotPosts,
  listHiveCollections,
  listHiveCredentials,
  listHiveDocuments,
  endHiveSessions,
  parseHiveGroupMap,
  readHiveBrand,
  readHiveRole,
  removeHivePerson,
  revokeMissingHiveSso,
  readBotPostArtifact,
  removeHiveCredential,
  saveHiveBotAvatar,
  saveHiveBrand,
  IsolationError,
  runAsSystem,
  setBotPublication,
} from "@rakazo/db";
import type { KnowledgeGrant, PrismaClient } from "@rakazo/db";
import type { RouterContext } from "./context.js";

function keyDeps(ctx: RouterContext) {
  return {
    prisma: ctx.deps.prisma,
    secretStore: ctx.deps.secrets,
    mcpAllowPrivateEndpoint: ctx.deps.env.mcpAllowPrivateEndpoint,
  };
}

async function requireHiveAdmin(ctx: RouterContext, userId: string, spaceId: string) {
  const hive = await readHiveRole(ctx.deps.prisma, { userId, spaceId });
  if (!hive || hive.archived || hive.role === "USER") throw new IsolationError();
  return hive;
}

function mimeFor(fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

async function knowledgeGrants(
  prisma: PrismaClient,
  organizationId: string,
  grants: Array<{ kind: KnowledgeGrant["kind"]; subjectId?: string }>,
): Promise<KnowledgeGrant[]> {
  const accepted: KnowledgeGrant[] = [];
  for (const grant of grants) {
    if (grant.kind === "organization") {
      accepted.push({ kind: "organization", subjectId: organizationId });
      continue;
    }
    if (!grant.subjectId) throw new IsolationError();
    if (grant.kind === "department") {
      const department = await runAsSystem("hive knowledge department", () =>
        prisma.department.findFirst({
          where: { id: grant.subjectId, organizationId },
          select: { id: true },
        }),
      );
      if (!department) throw new IsolationError();
      accepted.push({ kind: "department", subjectId: department.id });
      continue;
    }
    const role = await runAsSystem("hive knowledge person", () =>
      prisma.hiveRole.findFirst({
        where: { organizationId, userId: grant.subjectId },
        select: { userId: true },
      }),
    );
    if (!role) throw new IsolationError();
    accepted.push({ kind: "person", subjectId: role.userId });
  }
  return accepted;
}

export function hiveRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    hive: {
      linkConnection: authed.hive.linkConnection.handler(async ({ context, input }) => {
        await linkBotConnection(deps.prisma, context.actor, input.botId, input.connectionId);
        return { ok: true as const };
      }),
      assignDepartment: authed.hive.assignDepartment.handler(async ({ context, input }) => {
        const hive = await readHiveRole(deps.prisma, context.actor);
        if (!hive) throw new IsolationError();
        const departmentId = input.everyone
          ? await ensureEveryoneDepartment(deps.prisma, hive.organizationId)
          : input.departmentId;
        if (!departmentId) throw new IsolationError();
        await assignBotDepartment(
          deps.prisma,
          context.actor,
          input.botId,
          departmentId,
          input.accessLevel,
        );
        return { ok: true as const };
      }),
      setPublication: authed.hive.setPublication.handler(async ({ context, input }) => {
        await setBotPublication(deps.prisma, context.actor, input.botId, input.publication);
        return { ok: true as const };
      }),
      modelCatalog: authed.hive.modelCatalog.handler(async ({ context }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const litellm = hiveLiteLLM();
        if (!litellm) return { enabled: false, models: [] };
        return { enabled: true, models: await createLiteLLM(litellm).models() };
      }),
      departments: authed.hive.departments.handler(async ({ context }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return runAsSystem("hive departments", () =>
          deps.prisma.department.findMany({
            where: { organizationId: hive.organizationId },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
        );
      }),
      invite: authed.hive.invite.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const created = await createHiveInvite(deps.prisma, {
          organizationId: hive.organizationId,
          createdByUserId: context.actor.userId,
          email: input.email,
          role: input.role,
          departmentIds: input.departmentIds,
          webOrigin: deps.env.webOrigin,
        });
        const record = await readHiveBrand(deps.prisma, hive.organizationId);
        const message = hiveInviteMessage(
          record?.productName.trim() || hiveBrandDefaults().productName,
          created.link,
        );
        await deps.email
          ?.send({ to: input.email, subject: message.subject, text: message.text })
          .catch(() => undefined);
        return { link: created.link, expiresAt: created.expiresAt.toISOString() };
      }),
      brand: authed.hive.brand.handler(async ({ context }) => {
        const hive = await readHiveRole(deps.prisma, {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
        });
        if (!hive || hive.archived) throw new IsolationError();
        return loadHiveBrand(deps.prisma, hive.organizationId, true);
      }),
      saveBrand: authed.hive.saveBrand.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        if (input.primary && !brandColor(input.primary)) throw new ORPCError("BAD_REQUEST");
        if (input.accent && !brandColor(input.accent)) throw new ORPCError("BAD_REQUEST");
        const current = await readHiveBrand(deps.prisma, hive.organizationId);
        await saveHiveBrand(deps.prisma, {
          organizationId: hive.organizationId,
          productName: input.productName,
          loginText: input.loginText,
          primaryColor: input.primary || null,
          accentColor: input.accent || null,
          logoLightKey: current?.logoLightKey ?? null,
          logoDarkKey: current?.logoDarkKey ?? null,
          faviconKey: current?.faviconKey ?? null,
        });
        const shown = await loadHiveBrand(deps.prisma, hive.organizationId, false);
        return { primaryWarning: shown.primaryWarning, accentWarning: shown.accentWarning };
      }),
      saveBrandFile: authed.hive.saveBrandFile.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        if (input.slot === "bot" && !input.botId) throw new ORPCError("BAD_REQUEST");
        const bytes = Buffer.from(input.body, "base64");
        const inspected = inspectBrandImage(input.fileName, bytes);
        if ("error" in inspected) throw new ORPCError("BAD_REQUEST", { message: inspected.error });
        const slot = input.slot === "bot" ? `bot/${input.botId}` : input.slot;
        const key = brandObjectKey(hive.organizationId, slot, inspected.extension);
        if (input.slot === "bot") {
          const bot = await deps.prisma.bot.findFirst({
            where: { id: input.botId, spaceId: context.actor.spaceId },
            select: { id: true },
          });
          if (!bot || !input.botId) throw new IsolationError();
          await writeBrandFile(key, bytes);
          await saveHiveBotAvatar(deps.prisma, {
            botId: input.botId,
            organizationId: hive.organizationId,
            objectKey: key,
          });
          return { ok: true as const };
        }
        await writeBrandFile(key, bytes);
        const current = await readHiveBrand(deps.prisma, hive.organizationId);
        await saveHiveBrand(deps.prisma, {
          organizationId: hive.organizationId,
          productName: current?.productName ?? "",
          loginText: current?.loginText ?? null,
          primaryColor: current?.primaryColor ?? null,
          accentColor: current?.accentColor ?? null,
          logoLightKey: input.slot === "logoLight" ? key : (current?.logoLightKey ?? null),
          logoDarkKey: input.slot === "logoDark" ? key : (current?.logoDarkKey ?? null),
          faviconKey: input.slot === "favicon" ? key : (current?.faviconKey ?? null),
        });
        return { ok: true as const };
      }),
      setModel: authed.hive.setModel.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        try {
          await issueBotModelKey(keyDeps(ctx), {
            botId: input.botId,
            spaceId: context.actor.spaceId,
            orgId: hive.organizationId,
            model: input.model,
            monthlyBudget: input.monthlyBudget,
            modelKey: input.modelKey,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save the model key.";
          if (
            message === "LiteLLM is not configured." ||
            message === "Choose a model." ||
            message.startsWith("LiteLLM ")
          ) {
            throw new ORPCError("BAD_REQUEST", { message });
          }
          throw error;
        }
        return { ok: true as const };
      }),
      vaultStatus: authed.hive.vaultStatus.handler(async ({ context }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return { sealed: (await vaultHealth()) !== null };
      }),
      credentials: authed.hive.credentials.handler(async ({ context, input }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        return listHiveCredentials(deps.prisma, input.botId);
      }),
      saveCredential: authed.hive.saveCredential.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        return writeHiveCredential(deps.prisma, deps.secrets, {
          organizationId: hive.organizationId,
          botId: input.botId,
          kind: input.kind,
          label: input.label,
          value: input.value,
          actorUserId: context.actor.userId,
        });
      }),
      members: authed.hive.members.handler(async ({ context }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const roles = await runAsSystem("hive members", () =>
          deps.prisma.hiveRole.findMany({
            where: { organizationId: hive.organizationId },
            select: { userId: true },
          }),
        );
        return runAsSystem("hive member names", () =>
          deps.prisma.user.findMany({
            where: {
              id: { in: roles.map((role) => role.userId) },
              hiveService: false,
              hiveArchivedAt: null,
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
        );
      }),
      collections: authed.hive.collections.handler(async ({ context }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return listHiveCollections(deps.prisma, hive.organizationId);
      }),
      createCollection: authed.hive.createCollection.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return createHiveCollection(deps.prisma, {
          organizationId: hive.organizationId,
          name: input.name,
          actorUserId: context.actor.userId,
        });
      }),
      linkCollection: authed.hive.linkCollection.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        await linkHiveCollection(deps.prisma, {
          organizationId: hive.organizationId,
          collectionId: input.collectionId,
          botId: input.botId,
        });
        return { ok: true as const };
      }),
      documents: authed.hive.documents.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        return listHiveDocuments(deps.prisma, {
          organizationId: hive.organizationId,
          collectionId: input.collectionId,
        });
      }),
      saveDocument: authed.hive.saveDocument.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const storage = await openKnowledgeStorage();
        if (!storage) throw new ORPCError("BAD_REQUEST", { message: "Knowledge storage is not configured." });
        const grants = await knowledgeGrants(deps.prisma, hive.organizationId, input.grants);
        const bytes = Buffer.from(input.body, "base64");
        if (bytes.length === 0 || bytes.length > 8_000_000) {
          throw new ORPCError("BAD_REQUEST", { message: "The file is empty or too large." });
        }
        return ingestHiveDocument(deps.prisma, storage, {
          organizationId: hive.organizationId,
          collectionId: input.collectionId,
          title: input.title,
          fileName: input.fileName,
          mimeType: mimeFor(input.fileName),
          bytes,
          actorUserId: context.actor.userId,
          grants,
          ocr: input.ocr,
        });
      }),
      reprocessDocument: authed.hive.reprocessDocument.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const storage = await openKnowledgeStorage();
        if (!storage) throw new ORPCError("BAD_REQUEST", { message: "Knowledge storage is not configured." });
        const grants = await knowledgeGrants(deps.prisma, hive.organizationId, input.grants);
        return reprocessHiveDocument(deps.prisma, storage, {
          organizationId: hive.organizationId,
          documentId: input.documentId,
          actorUserId: context.actor.userId,
          grants,
        });
      }),
      removeDocument: authed.hive.removeDocument.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        await deleteHiveDocument(deps.prisma, await openKnowledgeStorage(), {
          organizationId: hive.organizationId,
          documentId: input.documentId,
        });
        return { ok: true as const };
      }),
      removeCredential: authed.hive.removeCredential.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const bot = await deps.prisma.bot.findFirst({
          where: { id: input.botId, spaceId: context.actor.spaceId },
          select: { id: true },
        });
        if (!bot) throw new IsolationError();
        const secretRef = await removeHiveCredential(deps.prisma, {
          botId: input.botId,
          label: input.label,
          actorUserId: context.actor.userId,
          organizationId: hive.organizationId,
        });
        if (secretRef) await deps.secrets.delete(secretRef, `bot:${input.botId}`).catch(() => undefined);
        return { ok: true as const };
      }),
      spend: authed.hive.spend.handler(async ({ context, input }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const report = await listBotSpend(keyDeps(ctx), context.actor.spaceId, input.month);
        return { month: input.month, ...report };
      }),
      sso: authed.hive.sso.handler(async ({ context }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const row = await runAsSystem("read hive sso", () =>
          deps.prisma.hiveSso.findUnique({ where: { organizationId: hive.organizationId } }),
        );
        return {
          issuer: row?.issuer ?? "",
          clientId: row?.clientId ?? "",
          enabled: row?.enabled ?? false,
          passwordLogin: row?.passwordLogin ?? true,
          groupMap: row?.groupMap ?? "",
          secretSet: Boolean(row?.secretRef),
        };
      }),
      saveSso: authed.hive.saveSso.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        if (input.enabled && (!input.issuer || !input.clientId)) throw new ORPCError("BAD_REQUEST");
        if (input.issuer) {
          const url = new URL(input.issuer);
          const insecure = process.env.OIDC_ALLOW_INSECURE === "true" && url.protocol === "http:";
          if ((url.protocol !== "https:" && !insecure) || url.username || url.password) {
            throw new ORPCError("BAD_REQUEST");
          }
        }
        const lines = input.groupMap
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        if (lines.length !== parseHiveGroupMap(input.groupMap).length) throw new ORPCError("BAD_REQUEST");
        const current = await runAsSystem("read hive sso secret", () =>
          deps.prisma.hiveSso.findUnique({
            where: { organizationId: hive.organizationId },
            select: { secretRef: true },
          }),
        );
        let secretRef = current?.secretRef ?? null;
        if (input.secret) {
          const path = `org/${hive.organizationId}/bot/_sso/client`;
          const secretContext: AdapterContext = {
            operationId: "hive-sso",
            traceId: "hive-sso",
            userId: context.actor.userId,
            spaceId: hive.organizationId,
            signal: AbortSignal.timeout(10_000),
          };
          const stored = await deps.secrets.put(input.secret, secretContext, { recordId: path });
          const loaded = await deps.secrets.load(
            stored.ciphertext,
            stored.ciphertext.startsWith("openbao:") ? "bot:_sso" : path,
          );
          if (loaded !== input.secret) throw new ORPCError("BAD_REQUEST");
          secretRef = stored.ciphertext;
        }
        if (input.enabled && !secretRef) throw new ORPCError("BAD_REQUEST");
        await runAsSystem("save hive sso", () =>
          deps.prisma.hiveSso.upsert({
            where: { organizationId: hive.organizationId },
            create: {
              organizationId: hive.organizationId,
              issuer: input.issuer,
              clientId: input.clientId,
              secretRef,
              enabled: input.enabled,
              passwordLogin: input.passwordLogin,
              groupMap: input.groupMap,
              updatedAt: new Date(),
            },
            update: {
              issuer: input.issuer,
              clientId: input.clientId,
              secretRef,
              enabled: input.enabled,
              passwordLogin: input.passwordLogin,
              groupMap: input.groupMap,
              updatedAt: new Date(),
            },
          }),
        );
        return { ok: true as const };
      }),
      ssoSync: authed.hive.ssoSync.handler(async ({ context, input }) => {
        const hive = await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const removed = await revokeMissingHiveSso(deps.prisma, hive.organizationId, input.subjects);
        return { removed: removed.length };
      }),
      deactivate: authed.hive.deactivate.handler(async ({ context, input }) => {
        await removeHivePerson(deps.prisma, context.actor, input.userId);
        await endHiveSessions(deps.prisma, input.userId);
        return { ok: true as const };
      }),
      status: authed.hive.status.handler(async ({ context }) => {
        await requireHiveAdmin(ctx, context.actor.userId, context.actor.spaceId);
        const sealed = await vaultHealth();
        const vaultOn = process.env.SECRET_STORE === "openbao";
        let diskFreeBytes: number | null = null;
        try {
          const space = statfsSync(process.env.DATA_DIR || "/data");
          diskFreeBytes = Number(space.bavail) * Number(space.bsize);
        } catch {
          diskFreeBytes = null;
        }
        const ssoRow = await runAsSystem("hive status sso", () =>
          deps.prisma.hiveSso.findFirst({ where: { enabled: true }, select: { organizationId: true } }),
        ).catch(() => null);
        return {
          version: process.env.RAKAZO_GIT_SHA ?? "",
          profiles: {
            litellm: Boolean(process.env.HIVE_LITELLM_BASE_URL),
            vault: vaultOn,
            knowledge: Boolean(process.env.HIVE_KNOWLEDGE_ENDPOINT),
            sso: Boolean(process.env.OIDC_ISSUER) || Boolean(ssoRow),
          },
          vault: vaultOn ? (sealed ? "sealed" : "open") : "off",
          diskFreeBytes,
        };
      }),
      inspectConversation: authed.hive.inspectConversation.handler(async ({ context, input }) => {
        const opened = await inspectConversation(deps.prisma, context.actor, input);
        return {
          threadId: opened.threadId,
          expiresAt: opened.expiresAt.toISOString(),
          messages: opened.messages,
        };
      }),
    },
    posts: {
      list: authed.posts.list.handler(async ({ input }) => {
        const posts = await listBotPosts(deps.prisma, input.botId);
        return posts.map((post) => ({
          id: post.id,
          content: post.content,
          createdAt: post.createdAt.toISOString(),
          artifacts: post.artifacts,
        }));
      }),
      artifact: authed.posts.artifact.handler(async ({ input }) =>
        readBotPostArtifact(deps.prisma, input.artifactId),
      ),
    },
  };
}
