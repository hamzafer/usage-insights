import { describe, expect, test } from "bun:test";
import { ApiError } from "./api";
import { settled, visibleState } from "./api-state";

const loadCodex = () => Promise.resolve("codex");
const loadClaude = () => Promise.resolve("claude");

describe("visibleState", () => {
  test("shows the data loaded for the current request", () => {
    expect(visibleState(settled(loadCodex, { status: "ready", data: "codex" }), loadCodex)).toEqual({
      status: "ready",
      data: "codex",
    });
  });

  test("never shows the previous tab's data under a new tab: loading until the new one lands", () => {
    expect(visibleState(settled(loadCodex, { status: "ready", data: "codex" }), loadClaude)).toEqual({ status: "loading" });
  });

  test("a previous request's error is not shown for the new one either", () => {
    const error = new ApiError("down", "offline");
    expect(visibleState(settled(loadCodex, { status: "error", error }), loadClaude)).toEqual({ status: "loading" });
  });

  test("nothing settled yet is loading", () => {
    expect(visibleState(null, loadCodex)).toEqual({ status: "loading" });
  });
});
