import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, describeRenderFailure } from "./AppErrorBoundary";

/**
 * Without a boundary, React 19 unmounts the whole tree when a render throws
 * and the participant is left on a permanently blank page. That is not a
 * theoretical risk on an iPad: WKWebView's localStorage accessors throw
 * SecurityError when the web-site data store is non-persistent, and that read
 * happens during the very first render.
 */
describe("describing a render failure", () => {
  it("uses the error's own message", () => {
    expect(describeRenderFailure(new Error("boom"))).toBe("boom");
  });

  it("survives a thrown value that is not an Error", () => {
    // React hands the boundary whatever was thrown, not necessarily an Error.
    expect(describeRenderFailure("plain string")).toBe("plain string");
    expect(describeRenderFailure({ code: 1 })).toBe("[object Object]");
  });

  it("never resolves to an empty string, which would render the children", () => {
    // render() branches on message === "", so an empty description would put
    // the crashed subtree back on screen - the blank page all over again.
    for (const thrown of [new Error(""), undefined, null, "", 0, {}, []]) {
      expect(describeRenderFailure(thrown)).not.toBe("");
    }
  });
});

describe("the boundary's state transition", () => {
  it("moves to the failed state when a child throws", () => {
    expect(AppErrorBoundary.getDerivedStateFromError(new Error("nope"))).toEqual({
      message: "nope",
    });
  });

  it("renders the children while nothing has thrown", () => {
    const children = "the app";
    const boundary = new AppErrorBoundary({ children });
    expect(boundary.render()).toBe(children);
  });

  it("renders a readable screen instead of the children once it has", () => {
    const boundary = new AppErrorBoundary({ children: "the app" });
    boundary.state = { message: "SecurityError: storage is blocked" };

    const rendered = boundary.render();
    expect(rendered).not.toBe("the app");

    // The crash screen must actually say something: a boundary that renders
    // an empty element is the same white page it exists to replace.
    const flatten = (node: unknown): string => {
      if (typeof node === "string") return node;
      if (typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(flatten).join(" ");
      if (node !== null && typeof node === "object" && "props" in node) {
        const props = (node as { props: { children?: unknown } }).props;
        return flatten(props.children);
      }
      return "";
    };
    const copy = flatten(rendered);
    expect(copy).toContain("Elderwise could not start");
    expect(copy).toContain("SecurityError: storage is blocked");
    expect(copy).toContain("Reload");
  });

  it("reports the failure to the console for the operator", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      new AppErrorBoundary({ children: null }).componentDidCatch(
        new Error("boom"),
        { componentStack: "  at App" },
      );
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });
});
