// Hive modification: admin knowledge collections. Derived from Rakazo (Apache License 2.0).

import { Button, Input } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";

type Rpc = ReturnType<typeof createSpaceRpc>;
type GrantKind = "organization" | "department" | "person";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function statusLabel(status: string): string {
  if (status === "processing") return "Processing";
  if (status === "ready") return "Ready";
  if (status === "needs_ocr") return "Needs OCR";
  return "Failed";
}

export function HiveKnowledge({ botId, rpc }: { botId: string; rpc: Rpc }) {
  const [collections, setCollections] = useState<{ id: string; name: string; botIds: string[] }[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [documents, setDocuments] = useState<
    { id: string; title: string; status: string; error: string | null; grants: { kind: GrantKind; subjectId: string }[] }[]
  >([]);
  const [title, setTitle] = useState("");
  const [grant, setGrant] = useState<GrantKind>("organization");
  const [subjectId, setSubjectId] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(nextCollection = collectionId) {
    const [rows, areas, people] = await Promise.all([
      rpc.hive.collections(),
      rpc.hive.departments(),
      rpc.hive.members(),
    ]);
    setCollections(rows);
    setDepartments(areas);
    setMembers(people);
    const selected = nextCollection || rows[0]?.id || "";
    setCollectionId(selected);
    setDocuments(selected ? await rpc.hive.documents({ collectionId: selected }) : []);
  }

  useEffect(() => {
    let live = true;
    refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!live) return;
      });
    return () => {
      live = false;
    };
    // The bot panel loads once per bot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
      await refresh(collectionId);
    } finally {
      setBusy(false);
    }
  }

  const grants = [{ kind: grant, subjectId: grant === "organization" ? undefined : subjectId }];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <Input
        aria-label="Collection"
        placeholder="Collection"
        className="h-8 w-40"
        value={collectionName}
        disabled={busy}
        onChange={(event) => setCollectionName(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !collectionName.trim()}
        onClick={() => {
          void run(async () => {
            const created = await rpc.hive.createCollection({ name: collectionName.trim() });
            setCollectionName("");
            setCollectionId(created.id);
          });
        }}
      >
        Create
      </Button>
      <select
        aria-label="Collection"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value={collectionId}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          setCollectionId(next);
          void rpc.hive.documents({ collectionId: next }).then(setDocuments).catch(() => undefined);
        }}
      >
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !collectionId}
        onClick={() => {
          void run(async () => {
            await rpc.hive.linkCollection({ collectionId, botId });
          });
        }}
      >
        Link
      </Button>
      <Input
        aria-label="Document"
        placeholder="Document"
        className="h-8 w-40"
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
      />
      <select
        aria-label="Access"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value={grant}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          setGrant(next === "department" || next === "person" ? next : "organization");
          setSubjectId("");
        }}
      >
        <option value="organization">Organization</option>
        <option value="department">Department</option>
        <option value="person">Person</option>
      </select>
      {grant === "department" ? (
        <select
          aria-label="Department"
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          value={subjectId}
          disabled={busy}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          <option value="">Department</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      ) : null}
      {grant === "person" ? (
        <select
          aria-label="Person"
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          value={subjectId}
          disabled={busy}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          <option value="">Person</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      ) : null}
      <input
        aria-label="File"
        type="file"
        accept=".pdf,.docx,.txt,.md,text/plain,text/markdown"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !collectionId || !title.trim() || !file || (grant !== "organization" && !subjectId)}
        onClick={() => {
          void run(async () => {
            if (!file) return;
            const saved = await rpc.hive.saveDocument({
              collectionId,
              title: title.trim(),
              fileName: file.name,
              body: toBase64(new Uint8Array(await file.arrayBuffer())),
              grants,
              ocr: false,
            });
            setTitle("");
            setFile(null);
            if (saved.error) setDocuments((current) => current);
          });
        }}
      >
        Save
      </Button>
      {documents.map((document) => (
        <span key={document.id} className="flex items-center gap-2 text-sm">
          <span>
            {document.title} {statusLabel(document.status)}
            {document.error ? ` ${document.error}` : ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await rpc.hive.reprocessDocument({ documentId: document.id, grants: document.grants });
              });
            }}
          >
            Reprocess
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await rpc.hive.removeDocument({ documentId: document.id });
              });
            }}
          >
            Remove
          </Button>
        </span>
      ))}
    </div>
  );
}
