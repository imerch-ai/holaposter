import type { PostStore } from "../routes/posts";

export const sharedPostStore: PostStore = {
  byId: new Map(),
  list: []
};
