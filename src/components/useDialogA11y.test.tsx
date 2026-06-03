import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useDialogA11y } from "./useDialogA11y";

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useDialogA11y<HTMLDivElement>(open, onClose);
  return (
    <>
      <div className="app">
        <button>background</button>
      </div>
      {open && (
        <div role="dialog" ref={ref}>
          <button>first</button>
          <button>last</button>
        </div>
      )}
    </>
  );
}

describe("useDialogA11y", () => {
  beforeEach(() => cleanup());

  it("marks the .app background inert + aria-hidden while open, and clears it on close", () => {
    const app = () => document.querySelector<HTMLElement>(".app")!;
    const { rerender } = render(<Harness open={false} onClose={() => {}} />);
    expect(app().getAttribute("aria-hidden")).toBeNull();

    rerender(<Harness open={true} onClose={() => {}} />);
    expect(app().getAttribute("aria-hidden")).toBe("true");
    expect(app().inert).toBe(true);

    rerender(<Harness open={false} onClose={() => {}} />);
    expect(app().getAttribute("aria-hidden")).toBeNull();
    expect(app().inert).toBe(false);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
