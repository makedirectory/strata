"use client";
import React from "react";

/**
 * Shared modal-dialog accessibility behaviour, so every `aria-modal` dialog
 * actually behaves like one:
 *
 * - moves focus into the dialog on open (first focusable, else the dialog box),
 * - **traps** Tab / Shift+Tab within the dialog,
 * - closes on Escape (via `onClose`),
 * - restores focus to the previously-focused element on close, and
 * - marks the background `.app` container `inert` + `aria-hidden` while any
 *   dialog is open (ref-counted, so overlapping dialogs restore correctly), so
 *   `aria-modal="true"` matches actual DOM inertness.
 *
 * Usage: `const ref = useDialogA11y<HTMLDivElement>(open, onClose)` and attach
 * `ref` to the dialog's root element. The owning component may be permanently
 * mounted and gate rendering on `open` — the hook keys off `open`, not mount.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Ref-count so two overlapping dialogs don't prematurely un-inert the background.
let inertCount = 0;

function setBackgroundInert(on: boolean) {
  if (typeof document === "undefined") return;
  const app = document.querySelector<HTMLElement>(".app");
  if (!app) return;
  if (on) {
    inertCount += 1;
    app.inert = true;
    app.setAttribute("aria-hidden", "true");
  } else {
    inertCount = Math.max(0, inertCount - 1);
    if (inertCount === 0) {
      app.inert = false;
      app.removeAttribute("aria-hidden");
    }
  }
}

export function useDialogA11y<T extends HTMLElement>(
  open: boolean,
  onClose?: () => void,
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const prevFocus = React.useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-running the effect on every render.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    setBackgroundInert(true);

    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      const target = el?.querySelector<HTMLElement>(FOCUSABLE) ?? el;
      target?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const el = ref.current;
      if (!el) return;
      // Visible, focusable elements currently inside the dialog.
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      setBackgroundInert(false);
      prevFocus.current?.focus?.();
    };
  }, [open]);

  return ref;
}
