(function () {
  const DB_NAME = "mycookbook_sync";
  const DB_VERSION = 1;
  const STORE = "files";
  const DAY_MS = 86400000;
  const MERGEABLE_PATHS = new Set([
    "data/recipes/_index.json",
    "data/ingredients/_index.json",
    "data/categories.json",
    "data/measures.json",
  ]);
  const objectUrlCache = new Map();
  let dbPromise = null;
  let syncing = false;

  function isMergeablePath(path) {
    return MERGEABLE_PATHS.has(String(path || ""));
  }

  function mergeNameKey(path) {
    return String(path || "").includes("recipes/_index") ? "title" : "name";
  }

  function itemsById(list) {
    const map = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      if (item && item.id != null) map.set(String(item.id), item);
    }
    return map;
  }

  function sameItem(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function sortMergedItems(items, path) {
    const key = mergeNameKey(path);
    if (window.CookbookData?.sortByName) return window.CookbookData.sortByName(items, key);
    return (items || []).slice().sort((a, b) =>
      String(a?.[key] || "").localeCompare(String(b?.[key] || ""), "pt", { sensitivity: "base" })
    );
  }

  function mergeItemLists(baseList, localList, remoteList) {
    const baseMap = itemsById(baseList);
    const localMap = itemsById(localList);
    const remoteMap = itemsById(remoteList);
    const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const merged = [];

    for (const id of ids) {
      const base = baseMap.get(id);
      const local = localMap.get(id);
      const remote = remoteMap.get(id);
      const inBase = baseMap.has(id);
      const inLocal = localMap.has(id);
      const inRemote = remoteMap.has(id);

      if (inLocal && inRemote) {
        if (sameItem(local, remote)) {
          merged.push(local);
        } else if (!inBase) {
          merged.push(local);
        } else if (sameItem(local, base)) {
          merged.push(remote);
        } else if (sameItem(remote, base)) {
          merged.push(local);
        } else {
          merged.push(local);
        }
        continue;
      }

      if (inLocal && !inRemote) {
        if (!inBase) {
          merged.push(local);
        } else if (!sameItem(local, base)) {
          merged.push(local);
        }
        continue;
      }

      if (!inLocal && inRemote) {
        if (!inBase) {
          merged.push(remote);
        } else if (!sameItem(remote, base)) {
          // Local deleted, remote edited — keep remote edit.
          merged.push(remote);
        }
        // else both agree on delete vs unchanged remote → drop
      }
    }

    return merged;
  }

  function formatJsonList(list) {
    return `${JSON.stringify(list, null, 2)}\n`;
  }

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

  async function describeRemote(path, token) {
    const file = await window.CookbookGitHub.getFile(path, token);
    if (!file) {
      return {
        fingerprint: fingerprint({ deleted: true, encoding: "utf-8", content: "" }),
        deleted: true,
        text: "",
      };
    }
    if (isBinaryPath(path)) {
      const content = String(file.content || "").replace(/\n/g, "");
      return {
        fingerprint: fingerprint({ deleted: false, encoding: "base64", content }),
        deleted: false,
        text: "",
      };
    }
    const text = decodeGitHubContent(file);
    return {
      fingerprint: fingerprint({ deleted: false, encoding: "utf-8", content: text }),
      deleted: false,
      text,
    };
  }

  function parseBaseList(baseRemote) {
    if (typeof baseRemote !== "string") return [];
    try {
      const payload = JSON.parse(baseRemote);
      if (payload?.deleted) return [];
      const parsed = JSON.parse(payload?.content || "[]");
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  async function tryRebaseMergeable(rec, remote) {
    if (!rec || rec.deleted || remote.deleted || !isMergeablePath(rec.path)) return false;
    let localList;
    let remoteList;
    try {
      localList = JSON.parse(rec.content || "[]");
      remoteList = JSON.parse(remote.text || "[]");
    } catch (_) {
      return false;
    }
    if (!Array.isArray(localList) || !Array.isArray(remoteList)) return false;

    const baseList = parseBaseList(rec.baseRemote);
    if (!Array.isArray(baseList)) return false;

    const merged = sortMergedItems(mergeItemLists(baseList, localList, remoteList), rec.path);
    const content = formatJsonList(merged);
    await putRecord({
      ...rec,
      encoding: "utf-8",
      content,
      deleted: false,
      dirty: true,
      baseRemote: remote.fingerprint,
    });
    return true;
  }

  async function rebaseDirtyAgainstRemote(dirty, token) {
    const hard = [];
    for (const rec of dirty || []) {
      if (!rec?.path) continue;
      const remote = await describeRemote(rec.path, token);
      const conflicted =
        typeof rec.baseRemote !== "string" || rec.baseRemote !== remote.fingerprint;
      if (!conflicted) continue;
      if (await tryRebaseMergeable(rec, remote)) continue;
      hard.push({ path: rec.path, rec, remote });
    }
    return hard;
  }

  function recipeIdFromPath(path) {
    const m = /^data\/recipes\/([^/]+)\.json$/.exec(String(path || ""));
    return m && m[1] !== "_index" ? m[1] : null;
  }

  function ingredientIdFromPath(path) {
    const m = /^data\/ingredients\/([^/]+)\.json$/.exec(String(path || ""));
    return m && m[1] !== "_index" ? m[1] : null;
  }

  async function patchIndexIdsFromRemote(indexPath, ids, token) {
    const idSet = new Set((ids || []).map(String).filter(Boolean));
    if (!idSet.size) return;
    const local = await getRecord(indexPath);
    if (!local?.dirty || local.deleted) return;

    let localList;
    try {
      localList = JSON.parse(local.content || "[]");
    } catch (_) {
      return;
    }
    if (!Array.isArray(localList)) return;

    const remote = await describeRemote(indexPath, token);
    let remoteList = [];
    try {
      remoteList = remote.deleted ? [] : JSON.parse(remote.text || "[]");
    } catch (_) {
      remoteList = [];
    }
    const remoteMap = itemsById(Array.isArray(remoteList) ? remoteList : []);

    const kept = localList.filter((item) => !idSet.has(String(item?.id)));
    for (const id of idSet) {
      if (remoteMap.has(id)) kept.push(remoteMap.get(id));
    }
    const merged = sortMergedItems(kept, indexPath);
    await putRecord({
      ...local,
      content: formatJsonList(merged),
      baseRemote: remote.deleted ? local.baseRemote : remote.fingerprint,
    });
  }

  async function discardPaths(paths, token) {
    const list = [...new Set((paths || []).filter(Boolean))];
    const recipeIds = [];
    const ingredientIds = [];
    for (const path of list) {
      await deleteRecord(path);
      const recipeId = recipeIdFromPath(path);
      if (recipeId) recipeIds.push(recipeId);
      const ingredientId = ingredientIdFromPath(path);
      if (ingredientId) ingredientIds.push(ingredientId);
    }
    if (recipeIds.length) {
      await patchIndexIdsFromRemote("data/recipes/_index.json", recipeIds, token);
    }
    if (ingredientIds.length) {
      await patchIndexIdsFromRemote("data/ingredients/_index.json", ingredientIds, token);
    }
    const remaining = await listDirty();
    if (remaining.length) {
      if (!readPendingSince()) writePendingSince(Date.now());
    } else {
      clearPendingSince();
    }
    emitStatus({ pending: remaining.length > 0, discarded: true });
    return remaining;
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

    let dirty = await listDirty();
    if (!dirty.length) {
      clearPendingSince();
      emitStatus({ pending: false });
      return { ok: true, count: 0 };
    }

    let discarded = false;
    const hardConflicts = await rebaseDirtyAgainstRemote(dirty, token);
    if (hardConflicts.length) {
      const resolve =
        options.resolveConflict || window.CookbookUI?.confirmSyncConflict?.bind(window.CookbookUI);
      const choice = resolve
        ? await resolve({ paths: hardConflicts.map((c) => c.path) })
        : "local";
      if (choice === "remote") {
        await discardPaths(
          hardConflicts.map((c) => c.path),
          token
        );
        discarded = true;
      } else if (choice !== "local") {
        emitStatus();
        return { ok: false, reason: "cancelled", discarded: false };
      }
    }

    dirty = await listDirty();
    if (!dirty.length) {
      clearPendingSince();
      emitStatus({ pending: false, discarded });
      return { ok: true, count: 0, discarded };
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
      emitStatus({ pending: remainingDirty, synced: true, discarded });
      return { ok: true, count: changes.length, remainingDirty, discarded };
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
      // Auto-merge indexes; skip committing if a hard file conflict needs a decision.
      await syncNow({ resolveConflict: async () => null });
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
