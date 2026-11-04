(function () {
  const VIEW_KEY = "mycookbook_view_mode";
  const DESKTOP_MQ = "(min-width: 800px)";
  const BLANK_PAGE = `<div class="book-read book-read--blank" aria-hidden="true"></div>`;
  const COVER_PAGE = "<!--book-cover-->";
  const HEART_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

  const state = {
    recipes: [],
    categories: [],
    categoryFilters: [],
    searchQuery: "",
    measures: [],
    ingredients: [],
    viewMode: "book",
    mode: "browse",
    browseIndex: 0,
    readingId: null,
    readingPageIndex: 0,
    readingPages: [],
    listPages: [],
    readingRecipe: null,
    flipping: false,
    filterOpen: false,
    favoriteIds: new Set(),
    favoritesOnly: false,
    coverPhase: "closed",
    pendingDeepLink: null,
  };

  let pageFlip = null;
  let flipSyncing = false;
  let lastFlipSize = null;
  let flipHtmlPages = [];
  let flipHasCover = false;
  let resizeTimer = null;
  let autoOpenTimer = null;
  let closeFallbackTimer = null;

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function isDesktop() {
    return window.matchMedia(DESKTOP_MQ).matches;
  }

  function categoryName(id) {
    return state.categories.find((c) => c.id === id)?.name || id || "Sem categoria";
  }

  const FAVORITES_DAY_MS = 86400000;

  function favoritesStorageKey() {
    return window.CookbookConfig?.storageKeys?.favorites || "mycookbook_favorites";
  }

  function favoritesCookCacheKey() {
    return window.CookbookConfig?.storageKeys?.favoritesCookCache || "mycookbook_favorites_cook";
  }

  function favoritesLastSyncKey() {
    return window.CookbookConfig?.storageKeys?.favoritesLastSync || "mycookbook_favorites_last_sync";
  }

  function parseFavoriteIds(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((id) => typeof id === "string" && id);
  }

  function sortedFavoriteIds(ids) {
    return [...ids].filter((id) => typeof id === "string" && id).sort();
  }

  function favoritesEqual(a, b) {
    const left = sortedFavoriteIds(a);
    const right = sortedFavoriteIds(b);
    if (left.length !== right.length) return false;
    return left.every((id, i) => id === right[i]);
  }

  function readLocalFavoriteIds(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return parseFavoriteIds(parsed);
    } catch (_) {
      return [];
    }
  }

  function writeLocalFavoriteIds(key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify([...ids]));
    } catch (_) {
      /* ignore */
    }
  }

  function saveFavoritesLocal() {
    if (window.CookbookAuth.isCook()) {
      writeLocalFavoriteIds(favoritesCookCacheKey(), state.favoriteIds);
    } else {
      writeLocalFavoriteIds(favoritesStorageKey(), state.favoriteIds);
    }
  }

  function readFavoritesLastSync() {
    try {
      const raw = localStorage.getItem(favoritesLastSyncKey());
      const ts = raw ? Number(raw) : NaN;
      return Number.isFinite(ts) ? ts : 0;
    } catch (_) {
      return 0;
    }
  }

  function writeFavoritesLastSync(ts = Date.now()) {
    try {
      localStorage.setItem(favoritesLastSyncKey(), String(ts));
    } catch (_) {
      /* ignore */
    }
  }

  function isFavoritesDailySyncDue() {
    return Date.now() - readFavoritesLastSync() >= FAVORITES_DAY_MS;
  }

  function hasLocalKey(key) {
    try {
      return localStorage.getItem(key) !== null;
    } catch (_) {
      return false;
    }
  }

  function loadVisitorFavorites() {
    state.favoriteIds = new Set(readLocalFavoriteIds(favoritesStorageKey()));
  }

  async function fetchRemoteFavoriteIds(token) {
    const file = await window.CookbookGitHub.getFile("data/favorites.json", token);
    if (!file) return [];
    const text = window.CookbookGitHub.decodeContent(file);
    return parseFavoriteIds(JSON.parse(text || "[]"));
  }

  async function maybeSyncCookFavoritesDaily() {
    if (!isFavoritesDailySyncDue()) return;

    const token = window.CookbookAuth.getToken();
    try {
      const remoteIds = await fetchRemoteFavoriteIds(token);
      const localIds = [...state.favoriteIds];

      if (localIds.length === 0 && remoteIds.length > 0) {
        state.favoriteIds = new Set(remoteIds);
        writeLocalFavoriteIds(favoritesCookCacheKey(), state.favoriteIds);
      } else if (!favoritesEqual(localIds, remoteIds)) {
        await window.CookbookGitHub.putJsonFile(
          "data/favorites.json",
          sortedFavoriteIds(state.favoriteIds),
          "Atualizar favoritos",
          token
        );
      }

      writeFavoritesLastSync();
    } catch (err) {
      console.warn("Favorites daily sync skipped:", err?.message || err);
    }
  }

  async function loadCookFavorites() {
    const cacheKey = favoritesCookCacheKey();

    if (hasLocalKey(cacheKey)) {
      state.favoriteIds = new Set(readLocalFavoriteIds(cacheKey));
    } else {
      const seed = readLocalFavoriteIds(favoritesStorageKey());
      state.favoriteIds = new Set(seed);
      writeLocalFavoriteIds(cacheKey, state.favoriteIds);
    }

    await maybeSyncCookFavoritesDaily();
  }

  async function loadFavorites() {
    if (window.CookbookAuth.isCook()) {
      await loadCookFavorites();
    } else {
      loadVisitorFavorites();
    }
  }

  function isFavorite(id) {
    return state.favoriteIds.has(id);
  }

  function favoriteBtnHtml(recipeId, extraClass = "") {
    const on = isFavorite(recipeId);
    const label = on ? "Remover dos favoritos" : "Adicionar aos favoritos";
    const cls = extraClass ? `favorite-btn ${extraClass}` : "favorite-btn";
    return `<button type="button" class="${cls}" data-favorite-toggle="${escapeHtml(recipeId)}" aria-pressed="${on ? "true" : "false"}" title="${label}" aria-label="${label}">${HEART_SVG}</button>`;
  }

  function syncFavoriteButtons() {
    document.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
      const id = btn.getAttribute("data-favorite-toggle");
      const on = isFavorite(id);
      const label = on ? "Remover dos favoritos" : "Adicionar aos favoritos";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.title = label;
    });
  }

  function refreshFavoriteUi() {
    if (state.mode === "browse" && state.favoritesOnly) {
      state.browseIndex = 0;
      state.listPages = [];
      render();
      return;
    }
    syncFavoriteButtons();
    updateChrome();
  }

  function toggleFavorite(id) {
    if (!id) return;
    if (state.favoriteIds.has(id)) state.favoriteIds.delete(id);
    else state.favoriteIds.add(id);
    saveFavoritesLocal();
    refreshFavoriteUi();
  }

  function toggleFavoritesFilter() {
    if (state.mode === "reading") return;
    state.favoritesOnly = !state.favoritesOnly;
    state.browseIndex = 0;
    state.listPages = [];
    render();
  }

  function visibleRecipes() {
    let recipes = state.recipes;
    if (state.favoritesOnly) {
      recipes = recipes.filter((recipe) => state.favoriteIds.has(recipe.id));
    }
    if (state.categoryFilters.length) {
      const allowed = new Set(state.categoryFilters);
      recipes = recipes.filter((recipe) => allowed.has(recipe.categoryId));
    }
    const query = state.searchQuery.trim().toLowerCase();
    if (query) {
      recipes = recipes.filter((recipe) =>
        String(recipe.title || "")
          .toLowerCase()
          .includes(query)
      );
    }
    return recipes;
  }

  function emptyBrowseHtml() {
    const narrowed =
      state.favoritesOnly || state.categoryFilters.length > 0 || state.searchQuery.trim();
    if (state.recipes.length && narrowed) {
      if (state.favoritesOnly && !state.favoriteIds.size) {
        return `<div class="empty">Nenhuma receita favorita ainda.</div>`;
      }
      return `<div class="empty">Nenhuma receita corresponde a estes filtros.</div>`;
    }
    return `<div class="empty">Nenhuma receita ainda.</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pagesPerSpread() {
    return isDesktop() ? 2 : 1;
  }

  function isBlankPageHtml(html) {
    return !html || html === BLANK_PAGE;
  }

  function padEvenPages(pages) {
    const list = pages.slice();
    if (!list.length) list.push(BLANK_PAGE);
    if (isDesktop() && list.length % 2 === 1) list.push(BLANK_PAGE);
    return list;
  }

  function contentPageCount(pages) {
    let n = pages.length;
    while (n > 0 && isBlankPageHtml(pages[n - 1])) n -= 1;
    return n;
  }

  function clampBrowseIndex() {
    const step = pagesPerSpread();
    if (state.mode === "reading") {
      if (!isDesktop()) {
        state.readingPageIndex = 0;
        return;
      }
      const content = contentPageCount(state.readingPages);
      const max = Math.max(0, content - step);
      let idx = Math.min(Math.max(0, state.readingPageIndex), max);
      idx -= idx % step;
      state.readingPageIndex = idx;
      return;
    }
    if (state.viewMode === "list" && isDesktop()) {
      const max = Math.max(0, state.listPages.length - step);
      let idx = Math.min(Math.max(0, state.browseIndex), max);
      idx -= idx % step;
      state.browseIndex = idx;
      return;
    }
    if (state.viewMode === "book") {
      const n = visibleRecipes().length;
      const content = n === 0 ? 1 : n;
      const max = Math.max(0, content - step);
      let idx = Math.min(Math.max(0, state.browseIndex), max);
      if (isDesktop()) idx -= idx % step;
      state.browseIndex = idx;
      return;
    }
    state.browseIndex = 0;
  }

  function flipStep() {
    if (pageFlip && typeof pageFlip.getOrientation === "function") {
      return pageFlip.getOrientation() === "portrait" ? 1 : 2;
    }
    return pagesPerSpread();
  }

  function coverIsInteractive() {
    return state.coverPhase !== "open";
  }

  function canFlipPrev() {
    if (coverIsInteractive()) return false;
    if (pageFlip && usesFlipBook()) {
      return pageFlip.getCurrentPageIndex() > 0;
    }
    if (state.mode === "reading") {
      return isDesktop() && state.readingPageIndex > 0;
    }
    if (state.viewMode === "list") {
      return isDesktop() && state.browseIndex > 0;
    }
    return state.browseIndex > 0;
  }

  function canFlipNext() {
    if (coverIsInteractive()) return false;
    if (pageFlip && usesFlipBook()) {
      const content = contentPageCount(flipHtmlPages.filter((p) => p !== COVER_PAGE));
      const idx = pageFlip.getCurrentPageIndex();
      return idx + flipStep() < content;
    }
    const step = pagesPerSpread();
    if (state.mode === "reading") {
      return isDesktop() && state.readingPageIndex + step < contentPageCount(state.readingPages);
    }
    if (state.viewMode === "list") {
      return isDesktop() && state.browseIndex + step < state.listPages.length;
    }
    return state.browseIndex + step < visibleRecipes().length;
  }

  function usesFlipBook() {
    if (coverIsInteractive() && state.mode === "browse") return true;
    return (
      (state.mode === "reading" && isDesktop()) ||
      (state.mode === "browse" && state.viewMode === "book")
    );
  }

  function browseContentHtmlPages() {
    const recipes = visibleRecipes();
    return recipes.length ? recipes.map((recipe) => previewHtml(recipe)) : [emptyBrowseHtml()];
  }

  function setFlipHostsVisible(flipActive) {
    const slot = qs("[data-flip-slot]");
    const spread = qs("[data-spread]");
    if (slot) slot.hidden = !flipActive;
    if (spread) spread.hidden = flipActive;
  }

  function ensureFlipRoot() {
    const slot = qs("[data-flip-slot]");
    if (!slot) return null;
    let root = qs("[data-flip-root]", slot);
    if (!root) {
      root = document.createElement("div");
      root.className = "book__flip";
      root.setAttribute("data-flip-root", "");
      const spine = qs(".book__flip-spine", slot);
      if (spine) slot.insertBefore(root, spine);
      else slot.appendChild(root);
    }
    return root;
  }

  function measureFlipSize() {
    const stage = qs(".book__stage");
    const stageW = Math.max(260, stage?.clientWidth || window.innerWidth - 32);
    const stageH = Math.min(window.innerHeight * (isDesktop() ? 0.72 : 0.7), isDesktop() ? 680 : 640);
    // Prefer a taller ~2:3 page so the flip reads more like a book than a magazine.
    if (isDesktop()) {
      const height = Math.max(360, Math.floor(stageH));
      const width = Math.max(280, Math.min(Math.floor(stageW / 2), Math.floor(height * 0.68)));
      return { width, height, minWidth: 260 };
    }
    const width = Math.max(260, Math.floor(stageW));
    const height = Math.max(360, Math.min(Math.floor(stageH), Math.floor(width / 0.68)));
    return {
      width,
      height,
      minWidth: Math.floor(stageW / 2) + 1,
    };
  }

  function createMeasurePageEl() {
    const size = measureFlipSize();
    const el = document.createElement("div");
    el.className = "book__page stf-page";
    el.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:${size.width}px;height:${size.height}px;`;
    document.body.appendChild(el);
    return el;
  }

  function isCoverPageHtml(html) {
    return html === COVER_PAGE;
  }

  function buildFlipPageEls(htmlPages) {
    return htmlPages.map((html) => {
      const el = document.createElement("div");
      el.className = "book__page stf-page";
      if (isCoverPageHtml(html)) {
        el.classList.add("book__page--cover");
        el.setAttribute("data-density", "hard");
        el.innerHTML = window.CookbookAuth.coverFaceHtml();
        return el;
      }
      const blank = isBlankPageHtml(html);
      el.classList.toggle("is-blank", blank);
      el.innerHTML = html || BLANK_PAGE;
      return el;
    });
  }

  function softenLastPageIfCover() {
    if (!pageFlip || !flipHasCover) return;
    try {
      const last = pageFlip.getPageCount() - 1;
      if (last > 0) pageFlip.getPage(last).setDensity("soft");
    } catch (_) {
      /* ignore */
    }
  }

  function syncFlipIndex(idx) {
    const page = Number(idx) || 0;
    if (state.mode === "reading") state.readingPageIndex = page;
    else {
      const contentIdx = flipHasCover ? Math.max(0, page - 1) : page;
      state.browseIndex = contentIdx;
    }
    updateChrome();
  }

  function onCoverFlipSettled() {
    if (!pageFlip) return;
    const idx = pageFlip.getCurrentPageIndex();
    if (state.coverPhase === "opening" && idx >= 1) finishCoverOpen();
    else if (state.coverPhase === "closing" && idx === 0) finishCoverClose();
  }

  function destroyPageFlipOnly() {
    if (!pageFlip) return;
    try {
      pageFlip.destroy();
    } catch (_) {
      /* ignore */
    }
    pageFlip = null;
    lastFlipSize = null;
    flipHasCover = false;
    ensureFlipRoot();
  }

  function teardownFlipBook() {
    destroyPageFlipOnly();
    flipHtmlPages = [];
    setFlipHostsVisible(false);
    state.flipping = false;
  }

  function mountFlipBook(htmlPages, startIndex, options = {}) {
    if (!window.St?.PageFlip) {
      console.warn("StPageFlip not loaded");
      return;
    }

    destroyPageFlipOnly();
    setFlipHostsVisible(true);

    const root = ensureFlipRoot();
    if (!root) return;

    flipHtmlPages = htmlPages.slice();
    flipHasCover = Boolean(options.showCover) || isCoverPageHtml(htmlPages[0]);
    const size = measureFlipSize();
    const pages = buildFlipPageEls(htmlPages);
    root.innerHTML = "";
    pages.forEach((page) => root.appendChild(page));

    const desktop = isDesktop();
    const maxIdx = Math.max(0, pages.length - 1);
    const start = Math.min(Math.max(0, startIndex || 0), maxIdx);
    // Only lock while sitting on the closed cover. During closing, flipPrev goes through
    // StPageFlip's flip(point) which no-ops when disableFlipByClick is true and the
    // synthetic left-edge point fails isPointOnCorners — that caused the snap-to-cover bug.
    pageFlip = new window.St.PageFlip(root, {
      width: size.width,
      height: size.height,
      size: "stretch",
      minWidth: size.minWidth,
      maxWidth: 900,
      minHeight: 360,
      maxHeight: 1200,
      drawShadow: true,
      flippingTime: 1300,
      usePortrait: !desktop,
      showCover: flipHasCover,
      autoSize: true,
      clickEventForward: true,
      disableFlipByClick: state.coverPhase === "closed",
      mobileScrollSupport: false,
      useMouseEvents: false,
      showPageCorners: false,
      startPage: start,
      maxShadowOpacity: 0.05,
    });

    pageFlip.on("flip", (e) => {
      if (flipSyncing) return;
      syncFlipIndex(e.data);
    });

    pageFlip.on("changeState", (e) => {
      state.flipping = e.data === "flipping";
      if (e.data === "read") onCoverFlipSettled();
    });

    pageFlip.loadFromHTML(pages);
    softenLastPageIfCover();
    lastFlipSize = { width: size.width, height: size.height, desktop, cover: flipHasCover };
    flipSyncing = true;
    try {
      pageFlip.turnToPage(start);
    } finally {
      flipSyncing = false;
    }
    bindOpenHandlers(qs("[data-flip-slot]"));
    if (flipHasCover && state.coverPhase === "closed") bindCoverAuth();
  }

  function refreshFlipBook(htmlPages, startIndex, options = {}) {
    setFlipHostsVisible(true);
    const size = measureFlipSize();
    const desktop = isDesktop();
    const wantCover = Boolean(options.showCover) || isCoverPageHtml(htmlPages[0]);
    const needRemount =
      !pageFlip ||
      !lastFlipSize ||
      lastFlipSize.width !== size.width ||
      lastFlipSize.height !== size.height ||
      lastFlipSize.desktop !== desktop ||
      lastFlipSize.cover !== wantCover;

    if (needRemount) {
      mountFlipBook(htmlPages, startIndex, { showCover: wantCover });
      return;
    }

    flipHtmlPages = htmlPages.slice();
    flipHasCover = wantCover;
    const pages = buildFlipPageEls(htmlPages);
    const maxIdx = Math.max(0, pages.length - 1);
    const start = Math.min(Math.max(0, startIndex || 0), maxIdx);
    flipSyncing = true;
    try {
      pageFlip.updateFromHtml(pages);
      softenLastPageIfCover();
      pageFlip.turnToPage(start);
    } finally {
      flipSyncing = false;
    }
    bindOpenHandlers(qs("[data-flip-slot]"));
    if (flipHasCover && state.coverPhase === "closed") bindCoverAuth();
  }

  function bindCoverAuth() {
    const root = qs("[data-flip-slot]") || qs("[data-flip-root]");
    window.CookbookAuth.bindCoverGate(root, () => {
      openFromCover();
    });
  }

  function openFromCover() {
    if (state.coverPhase !== "closed") return;
    if (!window.CookbookAuth.hasChosenRole()) return;
    if (!pageFlip) return;
    state.coverPhase = "opening";
    updateChrome();
    try {
      pageFlip.flipNext("bottom");
    } catch (_) {
      finishCoverOpen();
    }
  }

  function finishCoverOpen() {
    if (state.coverPhase !== "opening") return;
    state.coverPhase = "open";
    state.browseIndex = 0;
    document.body.classList.remove("is-gated");
    render();
    window.CookbookUI?.mountShell?.({ active: "home" });
    applyPendingDeepLink();
  }

  function finishCoverClose() {
    if (state.coverPhase !== "closing") return;
    clearTimeout(closeFallbackTimer);
    state.coverPhase = "closed";
    document.body.classList.add("is-gated");
    // Stay on the already-flipped cover — remounting would snap and kill the animation.
    bindCoverAuth();
    updateChrome();
    window.CookbookUI?.mountShell?.({ active: "home" });
  }

  function closeToCover() {
    if (state.coverPhase === "closed" || state.coverPhase === "closing") return;
    clearTimeout(autoOpenTimer);
    clearTimeout(closeFallbackTimer);

    // Capture current view before resetting — close from this page/spread, not page 1.
    let currentContentIndex = state.browseIndex;
    if (
      pageFlip &&
      !flipHasCover &&
      state.mode === "browse" &&
      state.viewMode === "book"
    ) {
      currentContentIndex = pageFlip.getCurrentPageIndex();
    }

    window.CookbookAuth.signOut();
    if (state.filterOpen) closeFilterPanel();
    state.mode = "browse";
    state.readingId = null;
    state.readingRecipe = null;
    state.readingPages = [];
    state.readingPageIndex = 0;
    state.browseIndex = 0;
    syncUrl();
    state.coverPhase = "closing";
    updateChrome();

    const content = padEvenPages(browseContentHtmlPages());
    if (!content.length) content.push(BLANK_PAGE);
    const idx = Math.min(Math.max(0, currentContentIndex), content.length - 1);
    let slice;
    if (isDesktop()) {
      const spreadStart = idx - (idx % 2);
      slice = content.slice(spreadStart, spreadStart + 2);
      if (slice.length === 1) slice.push(BLANK_PAGE);
    } else {
      slice = [content[idx] || BLANK_PAGE];
    }

    // Cover + current view only so one flipPrev hard-closes onto the cover.
    mountFlipBook([COVER_PAGE, ...slice], 1, { showCover: true });

    if (!pageFlip) {
      finishCoverClose();
      return;
    }

    const startFlipClose = () => {
      if (!pageFlip || state.coverPhase !== "closing") return;
      if (pageFlip.getCurrentPageIndex() <= 0) {
        finishCoverClose();
        return;
      }
      try {
        pageFlip.flipPrev("bottom");
      } catch (_) {
        flipSyncing = true;
        try {
          pageFlip.turnToPage(0);
        } finally {
          flipSyncing = false;
        }
        finishCoverClose();
        return;
      }
      clearTimeout(closeFallbackTimer);
      closeFallbackTimer = setTimeout(() => {
        if (state.coverPhase !== "closing") return;
        if (pageFlip && pageFlip.getCurrentPageIndex() > 0) {
          flipSyncing = true;
          try {
            pageFlip.turnToPage(0);
          } finally {
            flipSyncing = false;
          }
        }
        finishCoverClose();
      }, 2000);
    };

    requestAnimationFrame(startFlipClose);
  }

  function applyPendingDeepLink() {
    const pending = state.pendingDeepLink;
    state.pendingDeepLink = null;
    if (!pending) return;
    if (pending.shopping) {
      openShopping();
      return;
    }
    if (pending.recipeId) {
      void openRecipe(pending.recipeId);
    }
  }

  function previewHtml(recipe) {
    if (!recipe) return "";
    const id = escapeHtml(recipe.id);
    const title = escapeHtml(recipe.title);
    return `
      <div class="book-preview">
        <div class="book-preview__media-wrap">
          <button type="button" class="book-preview__media-btn" data-open-recipe="${id}" aria-label="Abrir ${title}">
            <img class="book-preview__media" src="${escapeHtml(recipe.image || "")}" alt="" />
          </button>
          ${favoriteBtnHtml(recipe.id, "book-preview__favorite")}
        </div>
        <button type="button" class="book-preview__text" data-open-recipe="${id}">
          <p class="book-preview__category">${escapeHtml(categoryName(recipe.categoryId))}</p>
          <h2 class="book-preview__title">${title}</h2>
        </button>
      </div>`;
  }

  function listRowHtml(recipe) {
    const id = escapeHtml(recipe.id);
    return `
      <div class="book-list__row">
        <button type="button" class="book-list__open" data-open-recipe="${id}">
          <img class="book-list__thumb" src="${escapeHtml(recipe.image || "")}" alt="" />
          <div class="book-list__meta">
            <p class="book-list__category">${escapeHtml(categoryName(recipe.categoryId))}</p>
            <h3 class="book-list__title">${escapeHtml(recipe.title)}</h3>
          </div>
        </button>
        ${favoriteBtnHtml(recipe.id, "book-list__favorite")}
      </div>`;
  }

  function listRowsHtml(recipes) {
    if (!recipes.length) return emptyBrowseHtml();
    return `<div class="book-list">${recipes.map(listRowHtml).join("")}</div>`;
  }

  function measureMap() {
    return Object.fromEntries(state.measures.map((m) => [m.id, m]));
  }

  function ingredientMap() {
    return Object.fromEntries(state.ingredients.map((i) => [i.id, i]));
  }

  function buildReadingBlocks(recipe) {
    const measures = measureMap();
    const ingredients = ingredientMap();
    const category = categoryName(recipe.categoryId);
    const blocks = [];

    blocks.push(`
      <div class="book-read__header">
        <p class="book-read__eyebrow">${escapeHtml(category)}</p>
        ${favoriteBtnHtml(recipe.id, "book-read__favorite")}
      </div>`);
    blocks.push(`<h1 class="book-read__title">${escapeHtml(recipe.title)}</h1>`);
    if (recipe.image) {
      blocks.push(`<img class="book-read__media" src="${escapeHtml(recipe.image)}" alt="" />`);
    }

    (recipe.groups || []).forEach((group) => {
      blocks.push(`<h2 class="book-read__section-title">${escapeHtml(group.name || "Seção")}</h2>`);
      blocks.push(`<p class="book-read__label">Ingredientes</p>`);
      const lines = group.ingredients || [];
      if (!lines.length) {
        blocks.push(`<p>Nenhum listado.</p>`);
      } else {
        lines.forEach((line) => {
          const ingredient = ingredients[line.ingredientId];
          const measure = measures[line.measureId];
          blocks.push(`
            <div class="ingredient-item">
              <img src="${escapeHtml(ingredient?.image || "")}" alt="" />
              <div><strong>${escapeHtml(ingredient?.name || line.ingredientId)}</strong></div>
              <span>${escapeHtml(window.CookbookData.formatQuantity(line.quantity, measure))}</span>
            </div>`);
        });
      }
      blocks.push(`<p class="book-read__label">Passos</p>`);
      const steps = group.steps || [];
      if (!steps.length) {
        blocks.push(`<p>Nenhum passo ainda.</p>`);
      } else {
        steps.forEach((step, index) => {
          blocks.push(
            `<p class="book-read__step"><strong>${index + 1}.</strong> ${escapeHtml(step.description)}</p>`
          );
        });
      }
    });

    return blocks;
  }

  function pageContentHeight(pageEl) {
    const styles = getComputedStyle(pageEl);
    const padTop = parseFloat(styles.paddingTop) || 0;
    const padBottom = parseFloat(styles.paddingBottom) || 0;
    return Math.max(120, pageEl.clientHeight - padTop - padBottom);
  }

  function pageInnerWidth(pageEl) {
    const styles = getComputedStyle(pageEl);
    const padL = parseFloat(styles.paddingLeft) || 0;
    const padR = parseFloat(styles.paddingRight) || 0;
    return Math.max(120, pageEl.clientWidth - padL - padR);
  }

  function packHtmlUnits(units, pageEl, wrapClass) {
    if (!units.length) return [`<div class="${wrapClass}"></div>`];
    const maxH = pageContentHeight(pageEl);
    const measure = document.createElement("div");
    measure.className = `book-measure ${wrapClass}`;
    measure.style.width = `${pageInnerWidth(pageEl)}px`;
    document.body.appendChild(measure);

    const pages = [];
    let current = [];

    function flush() {
      pages.push(`<div class="${wrapClass}">${current.join("")}</div>`);
      current = [];
      measure.innerHTML = "";
    }

    units.forEach((html) => {
      measure.innerHTML = current.join("") + html;
      if (measure.scrollHeight > maxH && current.length) {
        flush();
        current = [html];
        measure.innerHTML = html;
        if (measure.scrollHeight > maxH) flush();
      } else {
        current.push(html);
      }
    });

    if (current.length) flush();
    measure.remove();
    return pages.length ? pages : [`<div class="${wrapClass}"></div>`];
  }

  function packBlocks(blocks, pageEl) {
    return padEvenPages(packHtmlUnits(blocks, pageEl, "book-read"));
  }

  function packListPages(pageEl) {
    const recipes = visibleRecipes();
    if (!recipes.length) {
      state.listPages = padEvenPages([emptyBrowseHtml()]);
      return;
    }
    state.listPages = padEvenPages(
      packHtmlUnits(
        recipes.map((recipe) => listRowHtml(recipe)),
        pageEl,
        "book-list"
      )
    );
  }

  function setPage(el, html, { scrollable = false, blank = false } = {}) {
    if (!el) return;
    el.classList.toggle("is-scrollable", scrollable);
    el.classList.toggle("is-blank", blank);
    el.innerHTML = html || "";
  }

  function bindOpenHandlers(root) {
    if (!root) return;
    root.querySelectorAll("[data-open-recipe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openRecipe(btn.getAttribute("data-open-recipe"));
      });
    });
  }

  function updateChrome() {
    const modes = qs("[data-book-modes]");
    const actions = qs("[data-book-actions]");
    const search = qs("[data-book-search]");
    const readingBar = qs("[data-reading-bar]");
    const shoppingBar = qs("[data-shopping-bar]");
    const prev = qs("[data-prev]");
    const next = qs("[data-next]");
    const edit = qs("[data-edit]");
    const addToCart = qs("[data-add-to-cart]");
    const filterToggle = qs("[data-filter-toggle]");
    const reading = state.mode === "reading";
    const shopping = state.mode === "shopping";
    const immersed = reading || shopping;
    const coverClosed = coverIsInteractive();
    // Keep is-gated off while closing so the hard-close flip keeps open-book layout
    // (spine/stage). Gate styles apply once settled on the cover.
    const showGateShell = state.coverPhase === "closed" || state.coverPhase === "opening";

    document.body.classList.toggle("is-reading", reading && !coverClosed);
    document.body.classList.toggle("is-shopping", shopping && !coverClosed);
    document.body.classList.toggle("is-gated", showGateShell);

    if (modes) modes.hidden = immersed || coverClosed;
    if (actions) actions.hidden = immersed || coverClosed;
    if (search) search.hidden = immersed || coverClosed;
    if (readingBar) readingBar.hidden = !reading || coverClosed;
    if (shoppingBar) shoppingBar.hidden = !shopping || coverClosed;
    if ((immersed || coverClosed) && state.filterOpen) closeFilterPanel();

    qsAllModeButtons().forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.viewMode;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (filterToggle) {
      const filtered = state.categoryFilters.length > 0;
      filterToggle.setAttribute("aria-pressed", filtered ? "true" : "false");
      filterToggle.setAttribute("aria-expanded", state.filterOpen ? "true" : "false");
    }

    const favoritesBtn = qs("[data-favorites]");
    if (favoritesBtn) {
      favoritesBtn.setAttribute("aria-pressed", state.favoritesOnly ? "true" : "false");
      const favLabel = state.favoritesOnly ? "Mostrar todas as receitas" : "Mostrar favoritos";
      favoritesBtn.setAttribute("aria-label", favLabel);
      favoritesBtn.title = favLabel;
    }

    const visible = visibleRecipes();
    const showNav =
      !coverClosed &&
      !shopping &&
      ((reading &&
        isDesktop() &&
        contentPageCount(state.readingPages) > pagesPerSpread()) ||
        (!reading && state.viewMode === "book" && visible.length > 1) ||
        (!reading &&
          state.viewMode === "list" &&
          isDesktop() &&
          state.listPages.length > pagesPerSpread()));

    if (prev) prev.hidden = !(showNav && canFlipPrev());
    if (next) next.hidden = !(showNav && canFlipNext());

    window.CookbookAuth.applyCookUi(document);
    if (addToCart) {
      addToCart.hidden = !(reading && !!state.readingId);
    }
    if (edit) {
      const showEdit = reading && !!state.readingId && window.CookbookAuth.isCook();
      edit.hidden = !showEdit;
      if (showEdit) {
        edit.href = `edit.html?id=${encodeURIComponent(state.readingId)}`;
      } else {
        edit.removeAttribute("href");
      }
    }
  }

  function qsAllModeButtons() {
    return [...document.querySelectorAll("[data-book-modes] [data-view]")];
  }

  function syncFilterCheckboxes() {
    const list = qs("[data-filter-list]");
    if (!list) return;
    const selected = new Set(state.categoryFilters);
    list.querySelectorAll('input[type="checkbox"][data-category-id]').forEach((input) => {
      input.checked = selected.has(input.getAttribute("data-category-id"));
    });
  }

  function renderFilterList() {
    const list = qs("[data-filter-list]");
    if (!list) return;
    if (!state.categories.length) {
      list.innerHTML = `<p class="book-filter__empty">Nenhuma categoria ainda.</p>`;
      return;
    }
    const selected = new Set(state.categoryFilters);
    list.innerHTML = state.categories
      .map(
        (category) => `
      <label class="book-filter__option">
        <input
          type="checkbox"
          data-category-id="${escapeHtml(category.id)}"
          ${selected.has(category.id) ? "checked" : ""}
        />
        <span>${escapeHtml(category.name)}</span>
      </label>`
      )
      .join("");
  }

  function openFilterPanel() {
    const panel = qs("[data-filter-panel]");
    if (!panel) return;
    renderFilterList();
    state.filterOpen = true;
    panel.hidden = false;
    updateChrome();
  }

  function closeFilterPanel() {
    if (!state.filterOpen) return;
    state.filterOpen = false;
    const panel = qs("[data-filter-panel]");
    if (panel) panel.hidden = true;
  }

  function toggleFilterPanel() {
    if (state.filterOpen) {
      closeFilterPanel();
      updateChrome();
    } else {
      openFilterPanel();
    }
  }

  function applyFilters() {
    const list = qs("[data-filter-list]");
    const next = list
      ? [...list.querySelectorAll('input[type="checkbox"][data-category-id]:checked')].map((input) =>
          input.getAttribute("data-category-id")
        )
      : [];
    state.categoryFilters = next;
    state.browseIndex = 0;
    state.listPages = [];
    closeFilterPanel();
    render();
  }

  function resetFilters() {
    state.categoryFilters = [];
    state.browseIndex = 0;
    state.listPages = [];
    syncFilterCheckboxes();
    closeFilterPanel();
    render();
  }

  function renderBrowseBook() {
    clampBrowseIndex();
    const content = padEvenPages(browseContentHtmlPages());
    if (state.coverPhase === "open") {
      refreshFlipBook(content, state.browseIndex, { showCover: false });
      return;
    }
    if (state.coverPhase === "opening" || state.coverPhase === "closing") {
      if (!pageFlip) {
        const start = state.coverPhase === "closing" ? Math.min(1, content.length) : 0;
        refreshFlipBook([COVER_PAGE, ...content], start, { showCover: true });
      }
      return;
    }
    refreshFlipBook([COVER_PAGE, ...content], 0, { showCover: true });
  }

  function renderBrowseList() {
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');

    if (!isDesktop()) {
      setPage(left, "", { blank: true });
      setPage(right, listRowsHtml(visibleRecipes()), { scrollable: true });
      bindOpenHandlers(right);
      return;
    }

    packListPages(left);
    clampBrowseIndex();
    const leftHtml = state.listPages[state.browseIndex] || "";
    const rightHtml = state.listPages[state.browseIndex + 1] || "";
    setPage(left, leftHtml, { blank: !leftHtml });
    setPage(right, rightHtml, { blank: !rightHtml });
    bindOpenHandlers(qs("[data-spread]"));
  }

  function renderReadingPhone() {
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const blocks = buildReadingBlocks(state.readingRecipe);
    setPage(left, "", { blank: true });
    setPage(right, `<div class="book-read">${blocks.join("")}</div>`, { scrollable: true });
  }

  function renderReadingFlip() {
    if (!state.readingPages.length) {
      const measureTarget = createMeasurePageEl();
      try {
        const blocks = buildReadingBlocks(state.readingRecipe);
        state.readingPages = packBlocks(blocks, measureTarget);
      } finally {
        measureTarget.remove();
      }
    }
    clampBrowseIndex();
    refreshFlipBook(state.readingPages, state.readingPageIndex);
  }

  function renderShopping() {
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const html = window.CookbookShopping?.pageShellHtml?.() || "";
    setPage(left, "", { blank: true });
    setPage(right, html, { scrollable: true });
    void window.CookbookShopping?.renderPage?.();
  }

  function render() {
    clampBrowseIndex();
    if (coverIsInteractive() && state.mode === "browse") {
      renderBrowseBook();
      updateChrome();
      return;
    }
    if (state.mode === "shopping") {
      teardownFlipBook();
      renderShopping();
    } else if (state.mode === "reading" && state.readingRecipe) {
      if (isDesktop()) {
        renderReadingFlip();
      } else {
        teardownFlipBook();
        renderReadingPhone();
      }
    } else if (state.viewMode === "list") {
      teardownFlipBook();
      renderBrowseList();
    } else {
      renderBrowseBook();
    }
    updateChrome();
  }

  function flip(direction) {
    if (coverIsInteractive()) return;
    if (state.flipping || state.mode === "shopping") return;
    if (direction === "prev" && !canFlipPrev()) return;
    if (direction === "next" && !canFlipNext()) return;

    if (pageFlip && usesFlipBook()) {
      if (direction === "next") pageFlip.flipNext("bottom");
      else pageFlip.flipPrev("bottom");
      return;
    }

    const step = pagesPerSpread();
    if (state.mode === "reading") {
      state.readingPageIndex += direction === "next" ? step : -step;
    } else {
      state.browseIndex += direction === "next" ? step : -step;
    }
    render();
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    if (state.mode === "shopping") {
      url.searchParams.delete("recipe");
      url.searchParams.set("shopping", "1");
    } else if (state.mode === "reading" && state.readingId) {
      url.searchParams.delete("shopping");
      url.searchParams.set("recipe", state.readingId);
    } else {
      url.searchParams.delete("recipe");
      url.searchParams.delete("shopping");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function repackReadingSoon() {
    if (state.mode !== "reading" || !isDesktop()) return;
    requestAnimationFrame(() => {
      state.readingPages = [];
      render();
      qs("[data-flip-slot]")
        ?.querySelectorAll("img")
        .forEach((img) => {
          if (img.complete) return;
          img.addEventListener(
            "load",
            () => {
              if (state.mode !== "reading" || !isDesktop()) return;
              state.readingPages = [];
              render();
            },
            { once: true }
          );
        });
    });
  }

  async function openRecipe(id) {
    if (!id) return;
    try {
      const recipe = await window.CookbookData.loadRecipe(id);
      state.mode = "reading";
      state.readingId = id;
      state.readingRecipe = recipe;
      state.readingPageIndex = 0;
      state.readingPages = [];
      syncUrl();
      render();
      repackReadingSoon();
    } catch (err) {
      teardownFlipBook();
      const host = qs('[data-page="right"]') || qs('[data-page="left"]');
      setPage(host, `<div class="empty">${escapeHtml(err.message)}</div>`);
      updateChrome();
    }
  }

  function closeReading() {
    state.mode = "browse";
    state.readingId = null;
    state.readingRecipe = null;
    state.readingPages = [];
    state.readingPageIndex = 0;
    syncUrl();
    render();
  }

  function openShopping() {
    if (state.mode === "reading") {
      state.readingId = null;
      state.readingRecipe = null;
      state.readingPages = [];
      state.readingPageIndex = 0;
    }
    if (state.filterOpen) closeFilterPanel();
    state.mode = "shopping";
    syncUrl();
    render();
  }

  function closeShopping() {
    if (state.mode !== "shopping") return;
    state.mode = "browse";
    syncUrl();
    render();
  }

  function setViewMode(mode) {
    if (mode !== "book" && mode !== "list") return;
    if (coverIsInteractive()) return;
    if (state.mode === "reading" || state.mode === "shopping") return;
    state.viewMode = mode;
    state.browseIndex = 0;
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch (_) {
      /* ignore */
    }
    render();
  }

  function onFavoriteClick(e) {
    const fav = e.target.closest("[data-favorite-toggle]");
    if (!fav) return;
    e.preventDefault();
    e.stopPropagation();
    void toggleFavorite(fav.getAttribute("data-favorite-toggle"));
  }

  function onFlipSlotEdgeTap(e) {
    if (coverIsInteractive() || !usesFlipBook() || !pageFlip || state.flipping) return;
    if (e.target.closest("button, a, input, label, [data-open-recipe], [data-favorite-toggle]")) {
      return;
    }
    const slot = qs("[data-flip-slot]");
    if (!slot) return;
    const rect = slot.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    if (ratio <= 0.25) flip("prev");
    else if (ratio >= 0.75) flip("next");
  }

  function bindFlipGestures() {
    const slot = qs("[data-flip-slot]");
    if (!slot) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    slot.addEventListener(
      "touchstart",
      (e) => {
        if (coverIsInteractive() || !usesFlipBook() || state.flipping) return;
        const t = e.changedTouches[0];
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
      },
      { passive: true }
    );

    slot.addEventListener(
      "touchend",
      (e) => {
        if (!tracking) return;
        tracking = false;
        if (coverIsInteractive() || !usesFlipBook() || state.flipping) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
        if (dx < 0) flip("next");
        else flip("prev");
      },
      { passive: true }
    );

    slot.addEventListener("click", onFlipSlotEdgeTap);
  }

  function bindUi() {
    qsAllModeButtons().forEach((btn) => {
      btn.addEventListener("click", () => setViewMode(btn.getAttribute("data-view")));
    });
    qs("[data-prev]")?.addEventListener("click", () => flip("prev"));
    qs("[data-next]")?.addEventListener("click", () => flip("next"));
    qs("[data-back]")?.addEventListener("click", closeReading);
    qs("[data-add-to-cart]")?.addEventListener("click", () => {
      if (!state.readingRecipe) return;
      window.CookbookShopping?.openRecipePicker(
        state.readingRecipe,
        ingredientMap(),
        measureMap()
      );
    });
    qs("[data-filter-toggle]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFilterPanel();
    });
    qs("[data-filter-apply]")?.addEventListener("click", applyFilters);
    qs("[data-filter-reset]")?.addEventListener("click", resetFilters);
    qs("[data-favorites]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavoritesFilter();
    });
    qs("[data-spread]")?.addEventListener("click", onFavoriteClick);
    qs("[data-flip-slot]")?.addEventListener("click", onFavoriteClick);
    bindFlipGestures();
    qs("[data-filter-panel]")?.addEventListener("click", (e) => e.stopPropagation());
    qs("[data-recipe-search]")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value || "";
      state.browseIndex = 0;
      state.listPages = [];
      render();
    });

    document.addEventListener("click", () => {
      if (!state.filterOpen) return;
      closeFilterPanel();
      updateChrome();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (window.CookbookShopping?.hasOpenModal?.()) return;
        if (state.filterOpen) {
          closeFilterPanel();
          updateChrome();
          return;
        }
        if (state.mode === "shopping") {
          closeShopping();
          return;
        }
        if (state.mode === "reading") {
          closeReading();
          return;
        }
      }
      if (coverIsInteractive() || state.mode === "shopping") return;
      if (e.key === "ArrowLeft") flip("prev");
      if (e.key === "ArrowRight") flip("next");
    });

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.mode === "reading") state.readingPages = [];
        if (state.viewMode === "list") state.listPages = [];
        if (usesFlipBook()) lastFlipSize = null;
        render();
      }, 120);
    });
  }

  async function start({ recipes, categories }) {
    state.recipes = (recipes || []).slice().sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
    );
    state.categories = categories || [];
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "book" || saved === "list") state.viewMode = saved;
    } catch (_) {
      /* ignore */
    }
    await loadFavorites();

    try {
      [state.measures, state.ingredients] = await Promise.all([
        window.CookbookData.loadMeasures(),
        window.CookbookData.loadIngredientIndex(),
      ]);
    } catch (_) {
      state.measures = [];
      state.ingredients = [];
    }

    bindUi();

    const params = new URLSearchParams(window.location.search);
    state.pendingDeepLink = {
      recipeId: params.get("recipe"),
      shopping: params.get("shopping") === "1",
    };
    state.coverPhase = "closed";
    document.body.classList.add("is-gated");
    render();

    if (window.CookbookAuth.hasChosenRole()) {
      clearTimeout(autoOpenTimer);
      autoOpenTimer = setTimeout(() => openFromCover(), 480);
    }
  }

  window.CookbookBook = {
    start,
    openRecipe,
    closeReading,
    openShopping,
    closeShopping,
    closeToCover,
    openFromCover,
  };
})();
