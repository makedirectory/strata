"use strict";
/**
 * electron-builder `afterSign` hook — notarize the signed macOS .app via Apple's
 * notarytool. Runs only for mac builds and only when the Apple credentials are
 * present in the environment; otherwise it no-ops so unsigned local builds and
 * non-mac CI still succeed.
 *
 * CREDENTIALS COME FROM ENV VARS ONLY — never commit them:
 *   APPLE_ID                    Apple account email
 *   APPLE_APP_SPECIFIC_PASSWORD app-specific password (appleid.apple.com)
 *   APPLE_TEAM_ID               Developer Team ID
 *
 * Signing itself is handled by electron-builder from CSC_LINK / CSC_KEY_PASSWORD
 * (a Developer ID Application cert). See electron/README.md.
 */
const path = require("path");

exports.default = async function notarizeMac(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      "notarize: skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.",
    );
    return;
  }

  // Lazy require so the dependency is only needed on the signing machine.
  // eslint-disable-next-line global-require
  const { notarize } = require("@electron/notarize");
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`notarize: submitting ${appName}.app to notarytool…`);
  await notarize({
    tool: "notarytool",
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("notarize: done.");
};
