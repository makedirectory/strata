"use strict";
/**
 * Electron main process — the desktop shell for Strata.
 *
 * ADDITIVE ONLY: this does not touch the web app or its build. It reuses the
 * exact same Next.js app two ways:
 *   - dev  → loads a running `next dev` (ELECTRON_START_URL), for a fast loop.
 *   - prod → boots the bundled Next **standalone** server (produced by
 *            `BUILD_TARGET=electron next build`, shipped as an extraResource),
 *            then loads it. All the Node-only local features (Terraform
 *            child-process, provider SDKs) work because Electron carries Node.
 *
 * Nothing here runs during a normal web build/deploy.
 */
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const http = require("http");
const { fork } = require("child_process");

/** Dev: URL of a running `next dev`. Prod: undefined (we boot our own server). */
const DEV_URL = process.env.ELECTRON_START_URL || "";
const PORT = Number(process.env.STRATA_PORT || 34115);

/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;

/** Poll `url` until it answers (server booted), or reject after ~20s. */
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

/** Start the bundled Next standalone server and return its URL. */
async function startProdServer() {
  // Shipped via electron-builder `extraResources` → <resources>/standalone.
  const dir = path.join(process.resourcesPath, "standalone");
  const serverJs = path.join(dir, "server.js");
  serverProc = fork(serverJs, [], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      // Run server.js as plain Node under the Electron binary.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });
  const url = `http://127.0.0.1:${PORT}`;
  await waitForServer(url);
  return url;
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
  // Open target=_blank / external links in the user's browser, not a new window.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });
  win.loadURL(url);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.getApplicationMenu()); // default menu (copy/paste, devtools)
  try {
    const url = DEV_URL || (await startProdServer());
    createWindow(url);
  } catch (err) {
    // Surface a boot failure instead of a blank window.
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
});
