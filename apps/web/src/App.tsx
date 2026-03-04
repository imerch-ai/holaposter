import { useCallback, useEffect, useMemo, useState } from "react";

import { createDraft, listPosts, publishDraft, scheduleDraft } from "@/api/client";
import type { PostRecord, PostStatus } from "@/api/client";

function statusClass(status: PostStatus): string {
  if (status === "published") return "bg-green-100 text-green-800 border-green-200";
  if (status === "scheduled") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "failed") return "bg-red-100 text-red-800 border-red-200";
  if (status === "draft") return "bg-white text-zinc-700 border-zinc-300";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

function canPublish(status: PostStatus) {
  return status === "draft" || status === "failed";
}

function canSchedule(status: PostStatus) {
  return status === "draft" || status === "failed";
}

function defaultScheduledAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

export function App() {
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [composerContent, setComposerContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scheduledAtByPost, setScheduledAtByPost] = useState<Record<string, string>>({});

  const refreshPosts = useCallback(async () => {
    setLoading(true);
    try {
      const latest = await listPosts();
      setPosts(latest);
      setScheduledAtByPost((current) => {
        const next = { ...current };
        for (const post of latest) {
          if (!next[post.id]) {
            next[post.id] = post.scheduled_at
              ? new Date(post.scheduled_at).toISOString().slice(0, 16)
              : defaultScheduledAt();
          }
        }
        return next;
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "unknown_error";
      setMessage(`Load failed: ${text}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPosts();
    const timer = window.setInterval(() => void refreshPosts(), 3000);
    return () => window.clearInterval(timer);
  }, [refreshPosts]);

  const sortedPosts = useMemo(() => [...posts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [posts]);

  return (
    <main className="min-h-screen bg-linear-to-b from-white via-zinc-50 to-white text-zinc-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">HolaPoster</h1>
          <p className="text-sm text-zinc-500">Draft, publish, and schedule social posts in one sandbox workspace.</p>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-medium">Create Draft</h2>
          <p className="mb-4 text-sm text-zinc-500">Write content and enqueue publish jobs.</p>
          <div className="space-y-3">
            <textarea
              aria-label="draft-content"
              className="min-h-36 w-full rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300"
              rows={6}
              placeholder="Write post content..."
              value={composerContent}
              onChange={(event) => setComposerContent(event.target.value)}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">{composerContent.trim().length} chars</span>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={creating || composerContent.trim().length === 0}
                onClick={async () => {
                  setCreating(true);
                  setMessage(null);
                  try {
                    await createDraft(composerContent.trim());
                    setComposerContent("");
                    setMessage("Draft created.");
                    await refreshPosts();
                  } catch (error) {
                    const text = error instanceof Error ? error.message : "unknown_error";
                    setMessage(`Create failed: ${text}`);
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                {creating ? "Creating..." : "Create Draft"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Publish Queue</h2>
              <p className="text-sm text-zinc-500">Publish now or schedule for a specific time.</p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-xl border border-zinc-300 bg-zinc-50 px-3 text-sm"
              onClick={() => void refreshPosts()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          {sortedPosts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No drafts yet. Create your first post above.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedPosts.map((post) => {
                const busy = busyPostIds.has(post.id);
                return (
                  <article key={post.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusClass(post.status)}`}>
                        {post.status}
                      </span>
                      <span className="text-xs text-zinc-500">ID: {post.id.slice(0, 8)}</span>
                    </div>
                    <p className="mb-3 whitespace-pre-wrap text-sm leading-6">{post.content}</p>
                    {post.scheduled_at ? (
                      <p className="mb-3 text-xs text-zinc-500">
                        Scheduled: {new Date(post.scheduled_at).toLocaleString()}
                      </p>
                    ) : null}
                    {post.error_message ? (
                      <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {post.error_message}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className="inline-flex h-9 items-center rounded-xl bg-zinc-900 px-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busy || !canPublish(post.status)}
                        onClick={async () => {
                          setBusyPostIds((c) => new Set(c).add(post.id));
                          setMessage(null);
                          try {
                            await publishDraft(post.id);
                            setMessage(`Publish queued: ${post.id.slice(0, 8)}`);
                            await refreshPosts();
                          } catch (error) {
                            const text = error instanceof Error ? error.message : "unknown_error";
                            setMessage(`Publish failed: ${text}`);
                          } finally {
                            setBusyPostIds((c) => { const n = new Set(c); n.delete(post.id); return n; });
                          }
                        }}
                      >
                        {busy ? "Processing..." : "Publish now"}
                      </button>

                      <input
                        type="datetime-local"
                        className="h-9 rounded-xl border border-zinc-300 bg-white px-3 text-sm sm:w-52"
                        aria-label={`scheduled-at-${post.id}`}
                        value={scheduledAtByPost[post.id] ?? defaultScheduledAt()}
                        onChange={(event) =>
                          setScheduledAtByPost((c) => ({ ...c, [post.id]: event.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center rounded-xl border border-zinc-300 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busy || !canSchedule(post.status)}
                        onClick={async () => {
                          const localDatetime = scheduledAtByPost[post.id];
                          if (!localDatetime) return;
                          const scheduledAt = new Date(localDatetime).toISOString();
                          setBusyPostIds((c) => new Set(c).add(post.id));
                          setMessage(null);
                          try {
                            await scheduleDraft(post.id, scheduledAt);
                            setMessage(`Scheduled: ${post.id.slice(0, 8)}`);
                            await refreshPosts();
                          } catch (error) {
                            const text = error instanceof Error ? error.message : "unknown_error";
                            setMessage(`Schedule failed: ${text}`);
                          } finally {
                            setBusyPostIds((c) => { const n = new Set(c); n.delete(post.id); return n; });
                          }
                        }}
                      >
                        Schedule
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
      </div>
    </main>
  );
}

export default App;
