"use strict";
/**
 * Auto-update for the packaged desktop app, via electron-updater against the
 * GitHub Releases feed configured in electron-builder.yml (`publish: github`).
 *
 * Behaviour:
 *   - Checks on launch and then periodically (every 6h).
 *   - "Check for Updates…" menu item triggers a manual check with UI feedback.
 *   - On a downloaded update, prompts to restart and install.
 *
 * Guarded to packaged builds: in dev (`!app.isPackaged`) there's no update feed,
 * so init() no-ops and a manual check just says so. electron-updater is only
 * required lazily, inside the packaged path.
 */
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let manualCheckPending = false;

function getUpdater(dialog) {
  if (updater) return updater;
  // eslint-disable-next-line global-require
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    if (manualCheckPending) {
      dialog.showMessageBox({
        type: "info",
        message: `Downloading Strata ${info.version}…`,
        detail: "You'll be prompted to restart once it's ready.",
      });
    }
  });
  autoUpdater.on("update-not-available", () => {
    if (manualCheckPending) {
      manualCheckPending = false;
      dialog.showMessageBox({
        type: "info",
        message: "You're up to date.",
        detail: "Strata is running the latest version.",
      });
    }
  });
  autoUpdater.on("error", (err) => {
    const detail = String((err && err.message) || err);
    if (manualCheckPending) {
      manualCheckPending = false;
      dialog.showErrorBox("Update check failed", detail);
    } else {
      console.error("auto-update error:", detail);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    manualCheckPending = false;
    dialog
      .showMessageBox({
        type: "question",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Strata ${info.version} is ready to install.`,
        detail: "Restart to apply the update. It will also install next time you quit.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  updater = autoUpdater;
  return updater;
}

/** Wire up launch + periodic checks. Call once, after the app is ready. */
function init({ app, dialog }) {
  if (!app.isPackaged) return;
  try {
    const au = getUpdater(dialog);
    au.checkForUpdates().catch((err) => console.error("auto-update: launch check failed:", err));
    setInterval(() => {
      au.checkForUpdates().catch((err) =>
        console.error("auto-update: periodic check failed:", err),
      );
    }, SIX_HOURS);
  } catch (err) {
    console.error("auto-update: init failed:", (err && err.message) || err);
  }
}

/** Menu-driven manual check. Gives explicit UI feedback in every outcome. */
function checkForUpdatesManually({ app, dialog }) {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: "info",
      message: "Updates are managed by the installed app.",
      detail: "You're running a development build, so there's nothing to update here.",
    });
    return;
  }
  try {
    manualCheckPending = true;
    getUpdater(dialog)
      .checkForUpdates()
      .catch((err) => {
        manualCheckPending = false;
        dialog.showErrorBox("Update check failed", String((err && err.message) || err));
      });
  } catch (err) {
    manualCheckPending = false;
    dialog.showErrorBox("Update check failed", String((err && err.message) || err));
  }
}

module.exports = { init, checkForUpdatesManually };
