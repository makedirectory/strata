"use strict";
/**
 * Electron main process — the desktop shell for Strata.
 *
 * ADDITIVE ONLY: this does not touch the web app or its build. It reuses the
 * exact same Next.js app two ways:
 *   - dev  → loads a running `next dev` (ELECTRON_START_URL), for a fast loop.
 *   - prod → boots the bundled Next **standalone** server, then loads it.
 *
 * It also provides two desktop-only capabilities:
 *   - Durable storage: a JSON file in the OS user-data dir, exposed to the page
 *     via the preload (so diagrams persist outside the browser).
 *   - One-click "Connect to Claude Desktop / Cursor": merge the Strata MCP server
 *     into the client's config file.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

// --- MCP stdio mode: `Strata --mcp` (what the config we write invokes). MUST run
// before requiring electron: the config sets ELECTRON_RUN_AS_NODE=1, under which
// require("electron") returns a path string rather than the module.
if (process.argv.includes("--mcp") || process.env.STRATA_MCP === "1") {
  try {
    require("./mcp.cjs"); // bundled by electron/build-mcp.cjs; boots the stdio server
  } catch (err) {
    console.error("Strata MCP bundle unavailable:", err && err.message);
    process.exit(1);
  }
  return;
}

const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const http = require("http");
const { fork } = require("child_process");
const { createStorage } = require("./storage.cjs");
const updater = require("./updater.cjs");

const DEV_URL = process.env.ELECTRON_START_URL || "";
const PORT = Number(process.env.STRATA_PORT || 34115);

/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;

// ---- durable storage (SQLite in userData, JSON fallback; see storage.cjs) ----
// Bridged to the page via preload as a synchronous whole-map read/write. Built
// lazily on first use, since app.getPath("userData") requires app to be ready.
/** @type {ReturnType<typeof createStorage> | null} */
let store = null;
function storage() {
  if (!store) store = createStorage(app.getPath("userData"));
  return store;
}
ipcMain.on("strata-storage-read", (e) => {
  try {
    e.returnValue = storage().readAll();
  } catch {
    e.returnValue = null;
  }
});
ipcMain.on("strata-storage-write", (e, json) => {
  try {
    e.returnValue = storage().writeAll(json);
  } catch {
    e.returnValue = false;
  }
});

// ---- one-click "Connect to Claude Desktop / Cursor" ----
/** How the client should launch the Strata MCP server. */
function mcpServerSpec() {
  if (app.isPackaged) {
    // Re-invoke this app binary in MCP mode (see the --mcp guard above).
    return {
      command: process.execPath,
      args: ["--mcp"],
      env: { ELECTRON_RUN_AS_NODE: "1", STRATA_MCP: "1" },
    };
  }
  // Dev: run the repo's MCP server (cwd = the repo where `npm run app:dev` ran).
  return { command: "npm", args: ["run", "mcp"], cwd: process.cwd() };
}
function clientConfigPath(client) {
  const home = os.homedir();
  if (client === "cursor") return path.join(home, ".cursor", "mcp.json");
  if (process.platform === "darwin")
    return path.join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  if (process.platform === "win32")
    return path.join(
      process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}
/** Merge the Strata server into the client config (never clobbering other servers). */
function connectClient(client) {
  const file = clientConfigPath(client);
  let cfg = {};
  try {
    if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    cfg = {};
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
  cfg.mcpServers.strata = mcpServerSpec();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}
ipcMain.handle("strata-connect-mcp", (_e, client) => {
  const c = client === "cursor" ? "cursor" : "claude";
  try {
    return { ok: true, path: connectClient(c) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
function connectAndReport(client) {
  const label = client === "cursor" ? "Cursor" : "Claude Desktop";
  try {
    const p = connectClient(client);
    dialog.showMessageBox({
      type: "info",
      message: `Added the Strata MCP server to ${label}.`,
      detail: `Wrote ${p}\n\nRestart ${label} to load the Strata tools.`,
    });
  } catch (err) {
    dialog.showErrorBox("Connect failed", String((err && err.message) || err));
  }
}

// ---- server + window ----
function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const tick = () => {
      const req = http.get(url, () => {
        req.destroy();
        resolve();
      });
      req.on("error", () => {
        req.destroy();
        if (Date.now() > deadline) reject(new Error("Next server did not start in time"));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}
async function startProdServer() {
  const dir = path.join(process.resourcesPath, "standalone");
  serverProc = fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });
  const url = `http://127.0.0.1:${PORT}`;
  await waitForServer(url);
  return url;
}
function buildMenu() {
  const template = [];
  if (process.platform === "darwin") template.push({ role: "appMenu" });
  template.push({ role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" });
  template.push({
    label: "Tools",
    submenu: [
      { label: "Connect to Claude Desktop…", click: () => connectAndReport("claude") },
      { label: "Connect to Cursor…", click: () => connectAndReport("cursor") },
      { type: "separator" },
      {
        label: "Check for Updates…",
        click: () => updater.checkForUpdatesManually({ app, dialog }),
      },
    ],
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#070a12",
    title: "Strata",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });
  win.loadURL(url);
}

app.whenReady().then(async () => {
  buildMenu();
  updater.init({ app, dialog });
  try {
    const url = DEV_URL || (await startProdServer());
    createWindow(url);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Strata failed to start:", err);
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && (DEV_URL || serverProc)) {
      createWindow(DEV_URL || `http://127.0.0.1:${PORT}`);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", () => {
  if (serverProc) serverProc.kill();
  if (store) store.close();
});
