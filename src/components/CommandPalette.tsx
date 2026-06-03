"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFlow } from "../hooks/useFlow";
import { searchServices, serviceIcon } from "../aws/registry";
import { collectTagKeys } from "../aws/tags";
import { detectFixes } from "../aws/autofix";
import { PALETTE_ADD_EVENT } from "./Palette";
import { useDialogA11y } from "./useDialogA11y";

interface Command {
  id: string;
  title: string;
  hint?: string;
  group: string;
  run: () => void;
  /** Keep the palette open after running (e.g. zoom in/out). */
  keepOpen?: boolean;
  /** Mutates the model — hidden while presentation / read-only mode is on. */
  editing?: boolean;
}

/**
 * ⌘K command palette — the keyboard-driven hub for actions, adding services,
 * and jumping to placed nodes (with live on-canvas highlight). Opens on
 * ⌘/Ctrl+K or `/`; arrow keys + Enter to run, Esc to close.
 */
export const CommandPalette: React.FC = () => {
  const flow = useFlow();
  // `setSearchMatches` is a stable store setter — depend on it (not the whole
  // `flow` object, which is a fresh value every render) to avoid an effect loop.
  const { setSearchMatches } = flow;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tab-trap + focus restore + background inert (Escape/focus-in already handled
  // by this component's own logic, and remain idempotent).
  const dialogRef = useDialogA11y<HTMLDivElement>(open, () => setOpen(false));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSearchMatches(new Set());
  }, [setSearchMatches]);

  // Global open shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) close();
        else setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "/" && !open) {
        const ae = document.activeElement as HTMLElement | null;
        const tag = ae?.tagName?.toLowerCase();
        const typing =
          ae && (tag === "input" || tag === "textarea" || tag === "select" || ae.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus the input when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Static action/preset/view commands (filtered by title below).
  const staticCommands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: "fit", title: "Fit to view", group: "View", run: flow.fitToView },
      { id: "tidy", title: "Tidy — auto-arrange", group: "View", run: flow.tidy, editing: true },
      { id: "zoom-sel", title: "Zoom to selection", group: "View", run: flow.zoomToSelection },
      { id: "zoom-100", title: "Zoom to 100%", group: "View", run: flow.zoomReset },
      { id: "zoom-in", title: "Zoom in", group: "View", run: flow.zoomIn, keepOpen: true },
      { id: "zoom-out", title: "Zoom out", group: "View", run: flow.zoomOut, keepOpen: true },
      { id: "center", title: "Center", group: "View", run: flow.center },
      {
        id: "preset-network",
        title: "View: Network",
        group: "View",
        run: () => flow.applyViewPreset("network"),
      },
      {
        id: "preset-security",
        title: "View: Security",
        group: "View",
        run: () => flow.applyViewPreset("security"),
      },
      {
        id: "preset-data",
        title: "View: Data flow",
        group: "View",
        run: () => flow.applyViewPreset("data"),
      },
      {
        id: "preset-high",
        title: "View: High-level (collapse all)",
        group: "View",
        run: () => flow.applyViewPreset("high-level"),
      },
      {
        id: "preset-all",
        title: "View: Show all",
        group: "View",
        run: () => flow.applyViewPreset("all"),
      },
      {
        id: "edges-curved",
        title: "Edges: Curved",
        group: "View",
        run: () => flow.setEdgeStyle("curved"),
      },
      {
        id: "edges-ortho",
        title: "Edges: Orthogonal",
        group: "View",
        run: () => flow.setEdgeStyle("orthogonal"),
      },
      {
        id: "density-comfortable",
        title: "Density: Comfortable",
        group: "View",
        run: () => flow.setDensity("comfortable"),
      },
      {
        id: "density-compact",
        title: "Density: Compact",
        group: "View",
        run: () => flow.setDensity("compact"),
      },
      {
        id: "env-tint",
        title: `Environment tint: ${flow.environmentTint ? "off" : "on"}`,
        group: "View",
        run: () => flow.setEnvironmentTint(!flow.environmentTint),
      },
      {
        id: "present",
        title: `Presentation mode: ${flow.presentation ? "exit" : "enter"}`,
        group: "View",
        run: () => flow.setPresentation(!flow.presentation),
      },
      {
        id: "overlay-iam",
        title: "Overlay: IAM trust",
        group: "View",
        run: () => flow.setActiveOverlay("iam"),
      },
      {
        id: "overlay-security",
        title: "Overlay: Network paths",
        group: "View",
        run: () => flow.setActiveOverlay("security"),
      },
      {
        id: "overlay-heat",
        title: "Overlay: Heat (degree)",
        group: "View",
        run: () => flow.setActiveOverlay("heat"),
      },
      {
        id: "overlay-reachability",
        title: "Overlay: Internet reachability",
        group: "View",
        run: () => flow.setActiveOverlay("reachability"),
      },
      {
        id: "overlay-tags",
        title: "Overlay: Tags (tint by tag)",
        group: "View",
        run: () => {
          const keys = collectTagKeys(flow.snapshotGraph());
          if (keys.length === 0) return;
          flow.setTagTintKey(keys[0]);
          flow.setActiveOverlay("tags");
        },
        hint: "tint nodes by their first tag key",
      },
      {
        id: "overlay-none",
        title: "Overlay: None",
        group: "View",
        run: () => flow.setActiveOverlay("none"),
      },

      {
        id: "mode",
        title: "Toggle Connect / Move mode",
        group: "Edit",
        run: flow.toggleMode,
        editing: true,
      },
      {
        id: "start",
        title: "Start / New diagram…",
        group: "Edit",
        run: flow.openStartHub,
      },
      { id: "undo", title: "Undo", group: "Edit", run: flow.undo, editing: true },
      { id: "redo", title: "Redo", group: "Edit", run: flow.redo, editing: true },
      { id: "clear", title: "Clear canvas", group: "Edit", run: flow.clear, editing: true },

      { id: "validate", title: "Validate architecture", group: "Tools", run: flow.runValidateUI },
      { id: "rules", title: "Suggest rules", group: "Tools", run: flow.runRulesUI },
      {
        id: "autofix-first",
        title: "Autofix: apply first available fix",
        group: "Tools",
        editing: true,
        run: () => {
          const fixes = detectFixes(flow.snapshotGraph());
          if (fixes[0]) flow.applyAutofix(fixes[0].id);
        },
      },
      {
        id: "migrate-gcp",
        title: "Migrate diagram to Google Cloud",
        group: "Tools",
        run: () => flow.mapToTarget("gcp"),
      },
      {
        id: "migrate-azure",
        title: "Migrate diagram to Azure",
        group: "Tools",
        run: () => flow.mapToTarget("azure"),
      },
      {
        id: "migrate-aws",
        title: "Migrate diagram to AWS",
        group: "Tools",
        run: () => flow.mapToTarget("aws"),
      },
      { id: "export", title: "Export JSON", group: "Tools", run: flow.exportJSON },
      {
        id: "export-iac",
        title: "Export to IaC (Terraform / OpenTofu / CloudFormation)",
        group: "Tools",
        run: flow.openExportIaC,
      },
      {
        id: "import-json",
        title: "Import JSON",
        group: "Tools",
        run: flow.importJSONDialog,
        editing: true,
      },
      {
        id: "import-iac",
        title: "Import IaC (Terraform / OpenTofu / CloudFormation / ARM)",
        group: "Tools",
        run: flow.importIaCDialog,
        editing: true,
      },
      { id: "save", title: "Save diagram", group: "Tools", run: flow.saveGraph },
      {
        id: "connect-aws",
        title: "Connect to cloud (discover live resources)",
        group: "Tools",
        run: flow.openConnect,
      },
      {
        id: "preset-basic",
        title: "Load preset: Basic AWS",
        group: "Tools",
        run: () => flow.loadPreset("aws-basic"),
        editing: true,
      },
      {
        id: "preset-ecs",
        title: "Load preset: ECS + ALB",
        group: "Tools",
        run: () => flow.loadPreset("ecs-alb"),
        editing: true,
      },
    ];
    return cmds;
  }, [flow]);

  const q = query.trim().toLowerCase();

  // Node ids matching the query — drives the live on-canvas highlight.
  const nodeMatches = useMemo(() => {
    if (!q) return [];
    return flow.state.resources.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        r.serviceId.toLowerCase().includes(q) ||
        (r.arn ? r.arn.toLowerCase().includes(q) : false)
      );
    });
  }, [q, flow.state.resources]);

  // Push the live highlight set to the canvas while the palette is open. Keyed
  // on a stable id string so it only fires when the matches actually change
  // (not on every render — which would loop via setSearchMatches).
  const matchKey = useMemo(() => nodeMatches.map((r) => r.id).join(","), [nodeMatches]);
  useEffect(() => {
    // Highlight matches while open; clear them whenever the palette is closed
    // (covers Esc, backdrop click, and the ⌘K toggle path alike).
    setSearchMatches(open && matchKey ? new Set(matchKey.split(",")) : new Set());
  }, [open, matchKey, setSearchMatches]);

  const readOnly = flow.presentation;
  const commands = useMemo<Command[]>(() => {
    const filteredStatic = (
      q ? staticCommands.filter((c) => c.title.toLowerCase().includes(q)) : staticCommands
    ).filter((c) => !readOnly || !c.editing);
    // Adding services is an edit — omit it in read-only mode.
    const serviceCmds: Command[] =
      q && !readOnly
        ? searchServices(q)
            .slice(0, 6)
            .map((svc) => ({
              id: `add:${svc.id}`,
              title: `Add ${svc.name}`,
              hint: serviceIcon(svc.id),
              group: "Add service",
              run: () =>
                window.dispatchEvent(
                  new CustomEvent(PALETTE_ADD_EVENT, { detail: { serviceId: svc.id } }),
                ),
            }))
        : [];
    const nodeCmds: Command[] = nodeMatches.slice(0, 8).map((r) => ({
      id: `go:${r.id}`,
      title: `Go to ${r.name}`,
      hint: serviceIcon(r.serviceId),
      group: "Jump to node",
      run: () => flow.goToResource(r.id),
    }));
    return [...filteredStatic, ...serviceCmds, ...nodeCmds];
  }, [q, staticCommands, nodeMatches, flow, readOnly]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  // Keep the highlighted command visible when arrow-keys move the selection
  // past the visible window of the scrollable list.
  useEffect(() => {
    const id = commands[active]?.id;
    if (!id) return;
    document.getElementById(`cmdk-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, commands]);

  const runCommand = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return;
      cmd.run();
      if (!cmd.keepOpen) close();
    },
    [close],
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(commands.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(commands[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  return (
    <div className="cmdk-backdrop" onMouseDown={close}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command, service, or node…  (Esc to close)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
          aria-label="Command palette search"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={commands[active] ? `cmdk-${commands[active].id}` : undefined}
        />
        <div className="cmdk-list" id="cmdk-list" role="listbox">
          {commands.length === 0 && <div className="cmdk-empty">No matches</div>}
          {commands.map((c, i) => {
            const showGroup = i === 0 || commands[i - 1].group !== c.group;
            return (
              <React.Fragment key={c.id}>
                {showGroup && <div className="cmdk-group">{c.group}</div>}
                <div
                  id={`cmdk-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runCommand(c);
                  }}
                >
                  {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                  <span className="cmdk-title">{c.title}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
