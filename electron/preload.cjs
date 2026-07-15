"use strict";
/**
 * Preload — runs with contextIsolation before the page loads. Exposes the
 * desktop-only capabilities to the (otherwise sandboxed) web app under
 * `window.strataDesktop`:
 *   - `storage` — synchronous durable-storage bridge (a JSON file in userData);
 *     `src/lib/localStore.ts` prefers it over localStorage when present.
 *   - `connectClaude()` / `connectCursor()` — one-click MCP client setup.
 * On the web this global is absent and everything falls back to browser storage.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("strataDesktop", {
  version: process.env.npm_package_version || "",
  isDesktop: true,
  storage: {
    read: () => ipcRenderer.sendSync("strata-storage-read"),
    write: (json) => ipcRenderer.sendSync("strata-storage-write", json),
  },
  connectClaude: () => ipcRenderer.invoke("strata-connect-mcp", "claude"),
  connectCursor: () => ipcRenderer.invoke("strata-connect-mcp", "cursor"),
});
