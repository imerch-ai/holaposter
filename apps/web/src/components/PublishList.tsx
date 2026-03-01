import React from "react";

interface PostItem {
  id: string;
  content: string;
  status: string;
}

interface PublishListProps {
  posts: PostItem[];
  onPublish: (postId: string) => Promise<void>;
}

export function PublishList({ posts, onPublish }: PublishListProps) {
  return (
    <section>
      <h2>Drafts</h2>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <p>{post.content}</p>
            <p>Status: {post.status}</p>
            <button
              type="button"
              onClick={async () => {
                await onPublish(post.id);
              }}
              disabled={post.status !== "draft"}
            >
              Publish
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
