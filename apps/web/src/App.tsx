import { RefreshCw, Send, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDraft, listPosts, publishDraft, scheduleDraft, type PostRecord, type PostStatus } from "@/api/client";

const DEFAULT_CRON = "*/5 * * * * *";

function statusVariant(status: PostStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "published") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  if (status === "draft") {
    return "outline";
  }
  return "secondary";
}

function canManualPublish(status: PostStatus) {
  return status === "draft" || status === "failed";
}

export function App() {
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [composerContent, setComposerContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scheduleByPost, setScheduleByPost] = useState<Record<string, string>>({});
  const [holabossUserId, setHolabossUserId] = useState(
    (import.meta.env.VITE_DEFAULT_HOLABOSS_USER_ID as string | undefined) ?? "demo-user"
  );

  async function refreshPosts() {
    setLoading(true);
    try {
      const latest = await listPosts();
      setPosts(latest);
      setScheduleByPost((current) => {
        const next = { ...current };
        for (const post of latest) {
          if (!next[post.id]) {
            next[post.id] = post.schedule_cron ?? DEFAULT_CRON;
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
  }

  useEffect(() => {
    void refreshPosts();
    const timer = window.setInterval(() => {
      void refreshPosts();
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [posts]
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-muted/30 to-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">HolaPoster</h1>
          <p className="text-muted-foreground text-sm">
            Sandbox-ready posting workspace for drafting, publishing, and scheduled delivery.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Create Draft</CardTitle>
            <CardDescription>Write content and queue it to the publish pipeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              aria-label="holaboss-user-id"
              value={holabossUserId}
              onChange={(event) => setHolabossUserId(event.target.value)}
              placeholder="holaboss_user_id"
            />
            <Textarea
              aria-label="draft-content"
              rows={6}
              placeholder="Write post content..."
              value={composerContent}
              onChange={(event) => setComposerContent(event.target.value)}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <div className="text-muted-foreground text-xs">{composerContent.trim().length} chars</div>
            <Button
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
              <Send className="mr-1 size-4" />
              {creating ? "Creating..." : "Create Draft"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Publish Queue</CardTitle>
              <CardDescription>Monitor statuses and trigger manual/scheduled publish.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshPosts()} disabled={loading}>
              <RefreshCw className="mr-1 size-4" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {sortedPosts.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
                No drafts yet. Create your first post above.
              </div>
            ) : (
              sortedPosts.map((post) => {
                const busy = busyPostIds.has(post.id);
                return (
                  <div key={post.id} className="rounded-xl border bg-card/60 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={statusVariant(post.status)}>{post.status}</Badge>
                      <span className="text-muted-foreground text-xs">ID: {post.id.slice(0, 8)}</span>
                    </div>
                    <p className="mb-3 whitespace-pre-wrap text-sm leading-6">{post.content}</p>
                    {post.error_message ? (
                      <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                        {post.error_message}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !canManualPublish(post.status)}
                        onClick={async () => {
                          if (!holabossUserId.trim()) {
                            setMessage("Publish failed: holaboss_user_id is required");
                            return;
                          }
                          setBusyPostIds((current) => new Set(current).add(post.id));
                          setMessage(null);
                          try {
                            await publishDraft(post.id, holabossUserId.trim());
                            setMessage(`Publish queued: ${post.id.slice(0, 8)}`);
                            await refreshPosts();
                          } catch (error) {
                            const text = error instanceof Error ? error.message : "unknown_error";
                            setMessage(`Publish failed: ${text}`);
                          } finally {
                            setBusyPostIds((current) => {
                              const next = new Set(current);
                              next.delete(post.id);
                              return next;
                            });
                          }
                        }}
                      >
                        {busy ? "Processing..." : "Publish now"}
                      </Button>
                      <Input
                        className="sm:max-w-56"
                        aria-label={`schedule-cron-${post.id}`}
                        value={scheduleByPost[post.id] ?? DEFAULT_CRON}
                        onChange={(event) =>
                          setScheduleByPost((current) => ({
                            ...current,
                            [post.id]: event.target.value
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={async () => {
                          if (!holabossUserId.trim()) {
                            setMessage("Schedule failed: holaboss_user_id is required");
                            return;
                          }
                          const cron = scheduleByPost[post.id] ?? DEFAULT_CRON;
                          setBusyPostIds((current) => new Set(current).add(post.id));
                          setMessage(null);
                          try {
                            await scheduleDraft(post.id, holabossUserId.trim(), cron);
                            setMessage(`Schedule updated: ${post.id.slice(0, 8)}`);
                            await refreshPosts();
                          } catch (error) {
                            const text = error instanceof Error ? error.message : "unknown_error";
                            setMessage(`Schedule failed: ${text}`);
                          } finally {
                            setBusyPostIds((current) => {
                              const next = new Set(current);
                              next.delete(post.id);
                              return next;
                            });
                          }
                        }}
                      >
                        <Timer className="mr-1 size-4" />
                        Schedule
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {message ? <p className="text-sm">{message}</p> : null}
      </div>
    </main>
  );
}

export default App;
