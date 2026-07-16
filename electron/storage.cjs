"use strict";
/**
 * Durable diagram storage for the desktop shell.
 *
 * The renderer talks to storage through a **synchronous whole-map bridge**
 * (`preload.cjs` → `strata-storage-read` / `-write` in `main.cjs`): read returns
 * the entire id→graph JSON map as a string, write persists a replacement map.
 * `src/lib/localStore.ts` funnels every read/write through that bridge, so this
 * module must preserve the exact contract — a JSON string in, a JSON string out.
 *
 * Backing store, in preference order:
 *   1. **SQLite** (`better-sqlite3`) at `<userData>/graphs.db`, one row per graph.
 *      Scales to large libraries and writes only the rows that changed. It's a
 *      native module (optionalDependency); electron-builder rebuilds it for
 *      Electron's ABI at package time. See electron/README.md.
 *   2. **JSON file** (`<userData>/graphs.json`) — the original store, used as a
 *      graceful fallback when the native module can't load (e.g. an ABI mismatch
 *      on a dev build). The app never hard-fails over storage.
 *
 * On first SQLite run we migrate an existing `graphs.json` into the DB and leave
 * the file behind as `graphs.json.migrated` (a backup, never deleted).
 *
 * ADDITIVE: nothing here touches the web app, which stays on `localStorage`.
 */
const fs = require("fs");
const path = require("path");

/**
 * Split a desired id→graph map against the ids already stored into the rows to
 * upsert and the ids to delete. Pure so the whole-map→per-row reconciliation is
 * easy to reason about; `map` is the parsed bridge payload.
 */
function planWrite(existingIds, map) {
  const incoming = new Set(Object.keys(map));
  return {
    upserts: Object.entries(map).map(([id, graph]) => ({ id, json: JSON.stringify(graph) })),
    deletes: existingIds.filter((id) => !incoming.has(id)),
  };
}

/** JSON-file store — the original behaviour, kept as the no-native fallback. */
function jsonStore(file) {
  return {
    kind: "json",
    readAll() {
      try {
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      } catch {
        return null;
      }
    },
    writeAll(json) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof json === "string" ? json : "{}");
        return true;
      } catch {
        return false;
      }
    },
    close() {},
  };
}

/** SQLite store (one row per graph) behind the same whole-map surface. */
function sqliteStore(Database, dbFile, legacyJsonFile) {
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS graphs (id TEXT PRIMARY KEY, json TEXT NOT NULL)");

  const selectAll = db.prepare("SELECT id, json FROM graphs");
  const selectIds = db.prepare("SELECT id FROM graphs");
  const upsert = db.prepare(
    "INSERT INTO graphs (id, json) VALUES (@id, @json) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
  );
  const remove = db.prepare("DELETE FROM graphs WHERE id = ?");

  // First-run migration: import a legacy graphs.json, then keep it as a backup.
  const empty = db.prepare("SELECT COUNT(*) AS n FROM graphs").get().n === 0;
  if (empty && legacyJsonFile && fs.existsSync(legacyJsonFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyJsonFile, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const rows = Object.entries(parsed)
          .filter(([, g]) => g && typeof g === "object")
          .map(([id, g]) => ({ id, json: JSON.stringify(g) }));
        db.transaction((rs) => rs.forEach((r) => upsert.run(r)))(rows);
      }
      fs.renameSync(legacyJsonFile, `${legacyJsonFile}.migrated`);
    } catch {
      // Corrupt/locked legacy file: start empty rather than crash.
    }
  }

  const applyWrite = db.transaction((plan) => {
    plan.upserts.forEach((r) => upsert.run(r));
    plan.deletes.forEach((id) => remove.run(id));
  });

  return {
    kind: "sqlite",
    readAll() {
      const out = {};
      for (const row of selectAll.all()) {
        try {
          out[row.id] = JSON.parse(row.json);
        } catch {
          // Skip an unparseable row rather than fail the whole read.
        }
      }
      return JSON.stringify(out);
    },
    writeAll(json) {
      let map;
      try {
        map = JSON.parse(typeof json === "string" ? json : "{}");
      } catch {
        return false;
      }
      if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
      try {
        const existingIds = selectIds.all().map((r) => r.id);
        applyWrite(planWrite(existingIds, map));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Build the durable store for a userData directory. Tries SQLite; on any failure
 * to load/open the native module, transparently falls back to the JSON file so
 * the app still persists diagrams.
 */
function createStorage(userDataDir) {
  const jsonFile = path.join(userDataDir, "graphs.json");
  const dbFile = path.join(userDataDir, "graphs.db");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    // eslint-disable-next-line global-require
    const Database = require("better-sqlite3");
    return sqliteStore(Database, dbFile, jsonFile);
  } catch (err) {
    console.warn(
      "Strata: SQLite unavailable, using JSON storage fallback:",
      (err && err.message) || err,
    );
    return jsonStore(jsonFile);
  }
}

module.exports = { createStorage, planWrite, jsonStore };
