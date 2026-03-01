import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import App from "../src/App";

vi.mock("../src/api/client", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "1", content: "x", status: "draft" }),
  listPosts: vi.fn().mockResolvedValue([]),
  publishDraft: vi.fn().mockResolvedValue(undefined)
}));

describe("App", () => {
  it("shows create post form", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Create Draft" })).toBeTruthy();
  });
});
