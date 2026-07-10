"use strict";
/**
 * Preload — runs with contextIsolation before the page loads. Kept minimal for
 * now; it's the seam where a future one-click "Connect to Claude Desktop" (write
 * the MCP client config) or native file dialogs would be exposed via
 * contextBridge. Currently exposes only the app version.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("strataDesktop", {
  version: process.env.npm_package_version || "",
  isDesktop: true,
});
