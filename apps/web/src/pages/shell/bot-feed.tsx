// Hive modification: shared publication feed. Derived from Rakazo (Apache License 2.0).

import { useEffect, useState } from "react";
import { hiveBrandMark, useHiveBrand } from "../../lib/hive-brand";
import type { createSpaceRpc } from "../../lib/rpc";

type Post = {
  id: string;
  content: string;
  createdAt: string;
  artifacts: Array<{ id: string; name: string }>;
};

export function BotFeed({
  botId,
  rpc,
}: {
  botId: string;
  rpc: ReturnType<typeof createSpaceRpc>;
}) {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    let cancelled = false;
    void rpc.posts.list({ botId }).then((rows) => {
      if (!cancelled) setPosts(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [botId, rpc]);

  const brand = useHiveBrand();
  const logo = hiveBrandMark(brand);
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      {brand?.productName ? (
        <div className="mb-4 flex items-center gap-2">
          {logo ? <img src={logo} alt="" className="size-6 object-contain" /> : null}
          <span className="text-sm font-medium">{brand.productName}</span>
        </div>
      ) : null}
      {posts.map((post) => (
        <article key={post.id} className="border-b border-border py-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">{post.content}</p>
          {post.artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className="mt-2 text-sm underline"
              onClick={() => {
                void rpc.posts.artifact({ artifactId: artifact.id }).then((file) => {
                  const url = URL.createObjectURL(new Blob([file.body]));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = file.name;
                  link.click();
                  URL.revokeObjectURL(url);
                });
              }}
            >
              {artifact.name}
            </button>
          ))}
        </article>
      ))}
    </div>
  );
}
