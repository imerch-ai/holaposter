import React, { useEffect, useMemo, useState } from "react";

import { createDraft, listPosts, publishDraft } from "./api/client";
import { PostComposer } from "./components/PostComposer";
import { PublishList } from "./components/PublishList";

interface PostModel {
  id: string;
  content: string;
  status: string;
}

export default function App() {
  const [posts, setPosts] = useState<PostModel[]>([]);
  const holabossUserId = useMemo(
    () => (import.meta.env.VITE_DEFAULT_HOLABOSS_USER_ID as string | undefined) ?? "demo-user",
    []
  );

  async function refreshPosts() {
    const latestPosts = await listPosts();
    setPosts(latestPosts);
  }

  useEffect(() => {
    void refreshPosts();
  }, []);

  return (
    <main>
      <h1>Postsyncer</h1>
      <PostComposer
        onCreateDraft={async (content) => {
          await createDraft(content);
          await refreshPosts();
        }}
      />
      <PublishList
        posts={posts}
        onPublish={async (postId) => {
          await publishDraft(postId, holabossUserId);
          await refreshPosts();
        }}
      />
    </main>
  );
}
