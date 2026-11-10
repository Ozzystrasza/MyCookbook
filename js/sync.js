(function () {
  const DB_NAME = "mycookbook_sync";
  const DB_VERSION = 1;
  const STORE = "files";
  const DAY_MS = 86400000;
  const objectUrlCache = new Map();
  let dbPromise = null;
  let syncing = false;

  function storageKeys() {
    return window.CookbookConfig?.storageKeys || {};
  }

  function pendingSinceKey() {
    return storageKeys().syncPendingSince || "mycookbook_sync_pending_since";
  }

  function lastSyncKey() {
    return storageKeys().syncLastSync || "mycookbook_sync_last_sync";
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "path" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB indisponível."));
    });
    return dbPromise;
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getRecord(path) {
    if (!path) return null;
    const db = await openDb();
    return idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).get(path));
  }

  async function putRecord(record) {
    const db = await openDb();
    return idbRequest(db.transaction(STORE, "readwrite").objectStore(STORE).put(record));
  }

  async function deleteRecord(path) {
    if (!path) return;
    revokeObjectUrl(path);
    const db = await openDb();
    return idbRequest(db.transaction(STORE, "readwrite").objectStore(STORE).delete(path));
  }

  async function getAllRecords() {
    const db = await openDb();
    return idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
  }

  function fingerprint(rec) {
    return JSON.stringify({
      deleted: Boolean(rec?.deleted),
      encoding: rec?.encoding || "utf-8",
      content: rec?.content || "",
    });
  }

  function isBinaryPath(path) {
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(path || ""));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  function decodeGitHubContent(file) {
    if (!file?.content) return "";
    const normalized = String(file.content).replace(/\n/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function captureBaseRemote(path) {
    const existing = await getRecord(path);
    if (existing?.dirty && typeof existing.baseRemote === "string") return existing.baseRemote;
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (res.status === 404) {
        return fingerprint({ deleted: true, encoding: "utf-8", content: "" });
      }
      if (!res.ok) return null;
      if (isBinaryPath(path)) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        return fingerprint({
          deleted: false,
          encoding: "base64",
          content: bytesToBase64(bytes),
        });
      }
      return fingerprint({
        deleted: false,
        encoding: "utf-8",
        content: await res.text(),
      });
    } catch (_) {
      return fingerprint({ deleted: true, encoding: "utf-8", content: "" });
    }
  }

  async function remoteFingerprintFromGitHub(path, token) {
    const file = await window.CookbookGitHub.getFile(path, token);
    if (!file) return fingerprint({ deleted: true, encoding: "utf-8", content: "" });
    if (isBinaryPath(path)) {
      return fingerprint({
        deleted: false,
        encoding: "base64",
        content: String(file.content || "").replace(/\n/g, ""),
      });
    }
    return fingerprint({
      deleted: false,
      encoding: "utf-8",
      content: decodeGitHubContent(file),
    });
  }

  async function detectConflicts(dirty, token) {
    const conflicts = [];
    for (const rec of dirty || []) {
      if (!rec?.path) continue;
      const current = await remoteFingerprintFromGitHub(rec.path, token);
      if (typeof rec.baseRemote !== "string" || rec.baseRemote !== current) {
        conflicts.push({ path: rec.path });
      }
    }
    return conflicts;
  }

  async function discardAllPending() {
    const dirty = await listDirty();
    for (const rec of dirty) {
      await deleteRecord(rec.path);
    }
    clearPendingSince();
    emitStatus({ pending: false, discarded: true });
  }

  function readMetaNumber(key) {
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function writeMetaNumber(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (_) {
      /* ignore */
    }
  }

  function readPendingSince() {
    return readMetaNumber(pendingSinceKey());
  }

  function writePendingSince(ts) {
    writeMetaNumber(pendingSinceKey(), ts);
  }

  function clearPendingSince() {
    writeMetaNumber(pendingSinceKey(), null);
  }

  function writeLastSync(ts = Date.now()) {
    writeMetaNumber(lastSyncKey(), ts);
  }

  function emitStatus(extra = {}) {
    void hasPending().then((pending) => {
      window.dispatchEvent(
        new CustomEvent("cookbook:sync-status", {
          detail: { pending, syncing, ...extra },
        })
      );
    });
  }

  function revokeObjectUrl(path) {
    const url = objectUrlCache.get(path);
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlCache.delete(path);
  }

  function mimeFromPath(path) {
    const lower = String(path || "").toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    return "image/jpeg";
  }

  async function markDirty(path) {
    const since = readPendingSince();
    if (!since) writePendingSince(Date.now());
    emitStatus({ path });
  }

  async function writeText(path, text, message) {
    revokeObjectUrl(path);
    const baseRemote = await captureBaseRemote(path);
    await putRecord({
      path,
      encoding: "utf-8",
      content: String(text ?? ""),
      deleted: false,
      dirty: true,
      message: message || "",
      baseRemote,
    });
    await markDirty(path);
  }

  async function writeJson(path, data, message) {
    return writeText(path, JSON.stringify(data, null, 2) + "\n", message);
  }

  async function writeBase64(path, contentBase64, message) {
    revokeObjectUrl(path);
    const baseRemote = await captureBaseRemote(path);
    await putRecord({
      path,
      encoding: "base64",
      content: String(contentBase64 || ""),
      deleted: false,
      dirty: true,
      message: message || "",
      baseRemote,
    });
    await markDirty(path);
  }

  async function remove(path, message) {
    revokeObjectUrl(path);
    const baseRemote = await captureBaseRemote(path);
    await putRecord({
      path,
      encoding: "utf-8",
      content: "",
      deleted: true,
      dirty: true,
      message: message || "",
      baseRemote,
    });
    await markDirty(path);
  }

  async function listDirty() {
    const all = (await getAllRecords()) || [];
    return all.filter((r) => r && r.dirty);
  }

  async function hasPending() {
    const dirty = await listDirty();
    return dirty.length > 0;
  }

  async function hasLocalFile(path) {
    const rec = await getRecord(path);
    return Boolean(rec) && !rec.deleted;
  }

  async function forgetLocal(path) {
    await deleteRecord(path);
  }

  async function fetchNetworkText(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não foi possível carregar ${path}`);
    return res.text();
  }

  async function decodeLocalText(local) {
    if (local.encoding === "base64") {
      const binary = atob(String(local.content || "").replace(/\n/g, ""));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return String(local.content ?? "");
  }

  async function readText(path) {
    const local = await getRecord(path);
    if (local) {
      if (local.deleted) {
        if (local.dirty) {
          const err = new Error(`Não foi possível carregar ${path}`);
          err.code = "deleted";
          throw err;
        }
        await deleteRecord(path);
        return fetchNetworkText(path);
      }
      if (local.dirty) {
        return decodeLocalText(local);
      }
      // Clean local copies must not permanently shadow GitHub.
      await deleteRecord(path);
    }
    return fetchNetworkText(path);
  }

  async function readJson(path) {
    const text = await readText(path);
    return JSON.parse(text || "null");
  }

  async function objectUrl(path) {
    if (!path) return "";
    if (objectUrlCache.has(path)) return objectUrlCache.get(path);
    const local = await getRecord(path);
    if (!local || local.deleted) return path;
    if (!local.dirty) {
      await deleteRecord(path);
      return path;
    }
    if (local.encoding !== "base64" || !local.content) return path;
    try {
      const binary = atob(String(local.content).replace(/\n/g, ""));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeFromPath(path) }));
      objectUrlCache.set(path, url);
      return url;
    } catch (_) {
      return path;
    }
  }

  async function hydrateImages(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    const imgs = [...scope.querySelectorAll('img[src^="data/images/"]')];
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute("src");
        if (!src) return;
        const url = await objectUrl(src);
        if (url && url !== src) img.setAttribute("src", url);
      })
    );
  }

  async function finalizeSynced(snapshots) {
    let remainingDirty = false;
    for (const snap of snapshots) {
      const rec = await getRecord(snap.path);
      if (!rec) continue;
      if (fingerprint(rec) !== snap.fingerprint) {
        remainingDirty = true;
        continue;
      }
      // Drop synced local copy so future reads come from GitHub/Pages.
      await deleteRecord(snap.path);
    }
    if (remainingDirty) {
      if (!readPendingSince()) writePendingSince(Date.now());
    } else {
      clearPendingSince();
    }
    return remainingDirty;
  }

  async function syncNow(options = {}) {
    if (syncing) return { ok: false, reason: "busy" };
    const token = window.CookbookAuth?.getToken?.();
    if (!token) throw new Error("Faça login como cozinheiro para sincronizar.");

    const dirty = await listDirty();
    if (!dirty.length) {
      clearPendingSince();
      emitStatus({ pending: false });
      return { ok: true, count: 0 };
    }

    const conflicts = await detectConflicts(dirty, token);
    if (conflicts.length) {
      const resolve =
        options.resolveConflict || window.CookbookUI?.confirmSyncConflict?.bind(window.CookbookUI);
      const choice = resolve
        ? await resolve({ paths: conflicts.map((c) => c.path) })
        : "local";
      if (choice === "remote") {
        await discardAllPending();
        return { ok: true, discarded: true, count: 0 };
      }
      if (choice !== "local") {
        return { ok: false, reason: "cancelled" };
      }
    }

    const snapshots = dirty.map((rec) => ({
      path: rec.path,
      fingerprint: fingerprint(rec),
      deleted: Boolean(rec.deleted),
      encoding: rec.encoding === "base64" ? "base64" : "utf-8",
      content: rec.content || "",
    }));

    syncing = true;
    emitStatus({ pending: true });
    try {
      const changes = snapshots.map((snap) => {
        if (snap.deleted) return { path: snap.path, deleted: true };
        return {
          path: snap.path,
          encoding: snap.encoding,
          content: snap.content,
        };
      });
      await window.CookbookGitHub.commitChanges(
        changes,
        "Sincronizar alterações do cookbook",
        token
      );
      const remainingDirty = await finalizeSynced(snapshots);
      writeLastSync();
      emitStatus({ pending: remainingDirty, synced: true });
      return { ok: true, count: changes.length, remainingDirty };
    } catch (err) {
      emitStatus({ pending: true, error: err?.message || String(err) });
      throw err;
    } finally {
      syncing = false;
      emitStatus();
    }
  }

  async function maybeDailySync() {
    if (!window.CookbookAuth?.isCook?.()) return;
    const pending = await hasPending();
    if (!pending) return;
    const since = readPendingSince() || 0;
    if (!since || Date.now() - since < DAY_MS) return;
    try {
      await syncNow();
    } catch (err) {
      console.warn("Daily sync skipped:", err?.message || err);
    }
  }

  function isSyncing() {
    return syncing;
  }

  window.CookbookSync = {
    writeText,
    writeJson,
    writeBase64,
    remove,
    readText,
    readJson,
    hasPending,
    hasLocalFile,
    forgetLocal,
    listDirty,
    syncNow,
    discardAllPending,
    maybeDailySync,
    objectUrl,
    hydrateImages,
    isSyncing,
  };

  window.addEventListener("cookbook:ready", () => {
    void maybeDailySync();
  });
})();
