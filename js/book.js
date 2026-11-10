(function () {
  const VIEW_KEY = "mycookbook_view_mode";
  const DESKTOP_MQ = "(min-width: 800px)";
  const BLANK_PAGE = `<div class="book-read book-read--blank" aria-hidden="true"></div>`;
  const COVER_PAGE = "<!--book-cover-->";
  const HEART_SVG = (on) => (on ? window.CookbookIcons.favoriteFilled() : window.CookbookIcons.favorite());

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
    shoppingPages: [],
    shoppingPageIndex: 0,
    editRecipeId: null,
    editRecipeFrom: null,
    flipping: false,
    filterOpen: false,
    favoriteIds: new Set(),
    favoritesOnly: false,
    coverPhase: "closed",
    pendingDeepLink: null,
    skipModeBridge: false,
  };

  let pageFlip = null;
  let flipSyncing = false;
  let lastFlipSize = null;
  let flipHtmlPages = [];
  let flipHasCover = false;
  let resizeTimer = null;
  let lastResizeLayout = null;
  let autoOpenTimer = null;
  let closeFallbackTimer = null;
  let modeBridge = null;
  let modeBridgeTimer = null;
  let coverSlideTimer = null;
  let coverSlideX = 0;
  let coverSlideAnim = null;
  let pageFlipAudio = null;
  let searchDebounceTimer = null;

  function playPageFlipSound() {
    try {
      if (!pageFlipAudio) {
        pageFlipAudio = new Audio("data/sounds/page-flip.wav");
        pageFlipAudio.preload = "auto";
        pageFlipAudio.volume = 0.6;
      }
      pageFlipAudio.currentTime = 0;
      const play = pageFlipAudio.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } catch (_) {
      /* ignore missing file / autoplay */
    }
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function isDesktop() {
    return window.matchMedia(DESKTOP_MQ).matches;
  }

  function categoryName(id) {
    return state.categories.find((c) => c.id === id)?.name || id || "Sem categoria";
  }

  function favoritesStorageKey() {
    return window.CookbookConfig?.storageKeys?.favorites || "mycookbook_favorites";
  }

  function parseFavoriteIds(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((id) => typeof id === "string" && id);
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
    writeLocalFavoriteIds(favoritesStorageKey(), state.favoriteIds);
  }

  async function migrateFavoritesIfNeeded(storageKey) {
    let ids = readLocalFavoriteIds(storageKey);
    if (ids.length) return ids;

    const sync = window.CookbookSync;
    if (sync?.hasLocalFile && (await sync.hasLocalFile("data/favorites.json"))) {
      try {
        ids = parseFavoriteIds(await sync.readJson("data/favorites.json"));
      } catch (_) {
        ids = [];
      }
    }

    if (!ids.length) {
      ids = readLocalFavoriteIds("mycookbook_favorites_cook");
    }

    if (!ids.length && sync?.readJson) {
      try {
        ids = parseFavoriteIds(await sync.readJson("data/favorites.json"));
      } catch (_) {
        ids = [];
      }
    }

    if (ids.length) writeLocalFavoriteIds(storageKey, ids);
    return ids;
  }

  async function loadFavorites() {
    const storageKey = favoritesStorageKey();
    const ids = await migrateFavoritesIfNeeded(storageKey);
    state.favoriteIds = new Set(ids);
    if (window.CookbookSync?.forgetLocal) {
      await window.CookbookSync.forgetLocal("data/favorites.json");
    }
  }

  function isFavorite(id) {
    return state.favoriteIds.has(id);
  }

  function favoriteBtnHtml(recipeId, extraClass = "") {
    const on = isFavorite(recipeId);
    const label = on ? "Remover dos favoritos" : "Adicionar aos favoritos";
    const cls = extraClass ? `favorite-btn ${extraClass}` : "favorite-btn";
    return `<button type="button" class="${cls}" data-favorite-toggle="${escapeHtml(recipeId)}" aria-pressed="${on ? "true" : "false"}" title="${label}" aria-label="${label}">${HEART_SVG(on)}</button>`;
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
      btn.innerHTML = HEART_SVG(on);
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
        return `<div class="empty">Nenhuma receita favorita ainda. Toque no coração em uma receita para guardar.</div>`;
      }
      return `<div class="empty empty--with-action">
        <p>Nenhuma receita corresponde a estes filtros.</p>
        <button type="button" class="btn btn--ghost" data-clear-browse-filters>Limpar filtros</button>
      </div>`;
    }
    if (window.CookbookAuth?.isCook?.()) {
      return `<div class="empty empty--with-action">
        <p>Nenhuma receita ainda.</p>
        <button type="button" class="btn btn--primary" data-empty-new-recipe>Nova receita</button>
      </div>`;
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
    if (state.mode === "shopping") {
      if (!isDesktop()) {
        state.shoppingPageIndex = 0;
        return;
      }
      const content = contentPageCount(state.shoppingPages);
      const max = Math.max(0, content - step);
      let idx = Math.min(Math.max(0, state.shoppingPageIndex), max);
      idx -= idx % step;
      state.shoppingPageIndex = idx;
      return;
    }
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
    if (coverIsInteractive() || modeBridge) return false;
    if (pageFlip && usesFlipBook()) {
      return pageFlip.getCurrentPageIndex() > 0;
    }
    if (state.mode === "shopping") {
      return isDesktop() && state.shoppingPageIndex > 0;
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
    if (coverIsInteractive() || modeBridge) return false;
    if (pageFlip && usesFlipBook()) {
      const content = contentPageCount(flipHtmlPages.filter((p) => p !== COVER_PAGE));
      const idx = pageFlip.getCurrentPageIndex();
      return idx + flipStep() < content;
    }
    const step = pagesPerSpread();
    if (state.mode === "shopping") {
      return isDesktop() && state.shoppingPageIndex + step < contentPageCount(state.shoppingPages);
    }
    if (state.mode === "reading") {
      return isDesktop() && state.readingPageIndex + step < contentPageCount(state.readingPages);
    }
    if (state.viewMode === "list") {
      return isDesktop() && state.browseIndex + step < state.listPages.length;
    }
    return state.browseIndex + step < visibleRecipes().length;
  }

  function usesFlipBook() {
    if (modeBridge) return true;
    if (coverIsInteractive() && state.mode === "browse") return true;
    return (
      (state.mode === "shopping" && isDesktop()) ||
      (state.mode === "reading" && isDesktop()) ||
      (state.mode === "browse" && state.viewMode === "book")
    );
  }

  function isImmersedMode() {
    return (
      state.mode === "reading" ||
      state.mode === "shopping" ||
      state.mode === "editing" ||
      state.mode === "managing"
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

  function flipRootEl() {
    return qs("[data-flip-root]");
  }

  function syncFlipSpine() {
    if (isDesktop()) return;
    const slot = qs("[data-flip-slot]");
    const spine = slot && qs(".book__flip-spine", slot);
    if (!slot || !spine || slot.hidden) return;

    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    let anchor =
      findCoverAnchor(slot) ||
      [...slot.querySelectorAll(".stf__item, .book__page")].find(visible) ||
      null;

    if (!anchor) {
      const pages = [...slot.querySelectorAll(".stf__item, .book__page")].filter(visible);
      pages.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      anchor = pages[0] || null;
    }
    if (!anchor) return;

    const slotRect = slot.getBoundingClientRect();
    const pageRect = anchor.getBoundingClientRect();
    // Prefer painted page face height — StPageFlip's block can be shorter than the cover.
    const face = anchor.querySelector?.(".book-cover") || anchor;
    const faceRect = face.getBoundingClientRect();
    const height = Math.max(pageRect.height, faceRect.height);
    const top = Math.min(pageRect.top, faceRect.top) - slotRect.top;

    spine.style.top = `${Math.max(0, Math.round(top))}px`;
    spine.style.left = "0px";
    spine.style.height = `${Math.max(0, Math.round(height))}px`;
  }

  function findCoverAnchor(slot) {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }
    return (
      [...slot.querySelectorAll(".book__page--cover, .stf__item.--hard.--right")].find(visible) ||
      [...slot.querySelectorAll(".stf__item.--right, .book__page--right")].find(visible) ||
      null
    );
  }

  function whenCoverReady(cb) {
    const slot = qs("[data-flip-slot]");
    if (!slot) {
      cb(false);
      return;
    }
    let tries = 0;
    const tick = () => {
      if (findCoverAnchor(slot)) {
        cb(true);
        return;
      }
      tries += 1;
      if (tries >= 20) {
        cb(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function measureCoverCenterX() {
    const slot = qs("[data-flip-slot]");
    if (!slot) return 0;
    const cover = findCoverAnchor(slot);
    const width = cover?.getBoundingClientRect().width || lastFlipSize?.width || 0;
    if (width < 1) return 0;
    return -Math.round(width / 2);
  }

  function cancelCoverSlideAnim() {
    clearTimeout(coverSlideTimer);
    if (coverSlideAnim) {
      try {
        coverSlideAnim.cancel();
      } catch (_) {
        /* ignore */
      }
      coverSlideAnim = null;
    }
  }

  function commitFlipTranslateX(el, x) {
    if (!el) return;
    const px = Math.round(x);
    el.style.transform = `translateX(${px}px)`;
    coverSlideX = px;
  }

  function animateFlipTranslateX(el, fromX, toX) {
    if (!el) return Promise.resolve();
    const from = Math.round(fromX);
    const to = Math.round(toX);
    cancelCoverSlideAnim();

    if (from === to || typeof el.animate !== "function") {
      commitFlipTranslateX(el, to);
      return Promise.resolve();
    }

    commitFlipTranslateX(el, from);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(coverSlideTimer);
        coverSlideAnim = null;
        commitFlipTranslateX(el, to);
        resolve();
      };

      try {
        coverSlideAnim = el.animate(
          [
            { transform: `translateX(${from}px)` },
            { transform: `translateX(${to}px)` },
          ],
          {
            duration: 850,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "forwards",
          }
        );
        coverSlideAnim.finished.then(finish).catch(finish);
      } catch (_) {
        finish();
        return;
      }
      coverSlideTimer = setTimeout(finish, 1100);
    });
  }

  function clearCoverCenterClasses() {
    document.body.classList.remove("cover-centered", "cover-moving");
    cancelCoverSlideAnim();
    const root = flipRootEl();
    commitFlipTranslateX(root, 0);
  }

  function setCoverCentered({ animate } = { animate: false }) {
    if (!isDesktop() || state.coverPhase !== "closed") {
      clearCoverCenterClasses();
      return;
    }
    const root = flipRootEl();
    if (!root) return;
    whenCoverReady(() => {
      if (state.coverPhase !== "closed") return;
      const centerX = measureCoverCenterX();
      document.body.classList.add("cover-centered");
      if (animate) {
        document.body.classList.add("cover-moving");
        animateFlipTranslateX(root, coverSlideX || 0, centerX).then(() => {
          document.body.classList.remove("cover-moving");
        });
      } else {
        commitFlipTranslateX(root, centerX);
      }
    });
  }

  function dockCoverFromCenter() {
    return new Promise((resolve) => {
      if (!isDesktop()) {
        clearCoverCenterClasses();
        resolve();
        return;
      }
      const root = flipRootEl();
      if (!root) {
        clearCoverCenterClasses();
        resolve();
        return;
      }
      const fromX = coverSlideX || measureCoverCenterX();
      document.body.classList.add("cover-moving");
      // Force the starting pose before tweening so we never snap from an unknown transform.
      commitFlipTranslateX(root, fromX);
      animateFlipTranslateX(root, fromX, 0).then(() => {
        document.body.classList.remove("cover-centered", "cover-moving");
        resolve();
      });
    });
  }

  function centerCoverAfterClose() {
    if (!isDesktop()) {
      clearCoverCenterClasses();
      return;
    }
    const root = flipRootEl();
    if (!root) return;
    whenCoverReady(() => {
      if (state.coverPhase !== "closed") return;
      const centerX = measureCoverCenterX();
      commitFlipTranslateX(root, 0);
      document.body.classList.add("cover-moving", "cover-centered");
      animateFlipTranslateX(root, 0, centerX).then(() => {
        document.body.classList.remove("cover-moving");
      });
    });
  }

  function syncCoverLayout() {
    if (state.coverPhase === "closed" && isDesktop()) {
      setCoverCentered({ animate: false });
    } else {
      clearCoverCenterClasses();
    }
    requestAnimationFrame(() => {
      syncFlipSpine();
      requestAnimationFrame(syncFlipSpine);
    });
  }

  function measureFlipSize() {
    const stage = qs(".book__stage");
    const gatedCover = document.body.classList.contains("is-gated");
    const stageW = Math.max(260, stage?.clientWidth || window.innerWidth - 32);
    const stageH = gatedCover
      ? Math.min(window.innerHeight * (isDesktop() ? 0.86 : 0.82), isDesktop() ? 820 : 760)
      : Math.min(window.innerHeight * (isDesktop() ? 0.72 : 0.7), isDesktop() ? 680 : 640);
    // Prefer a taller ~2:3 page so the flip reads more like a book than a magazine.
    if (isDesktop()) {
      const height = Math.max(360, Math.floor(stageH));
      const width = Math.max(280, Math.min(Math.floor(stageW / 2), Math.floor(height * 0.68)));
      return { width, height, minWidth: 260 };
    }
    const width = Math.max(260, Math.floor(stageW));
    const height = Math.max(
      360,
      Math.min(Math.floor(stageH), Math.floor(width / (gatedCover ? 0.72 : 0.68)))
    );
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
    if (modeBridge) return;
    const page = Number(idx) || 0;
    if (state.mode === "reading") state.readingPageIndex = page;
    else if (state.mode === "shopping") state.shoppingPageIndex = page;
    else {
      const contentIdx = flipHasCover ? Math.max(0, page - 1) : page;
      state.browseIndex = contentIdx;
    }
    updateChrome();
  }

  function onCoverFlipSettled() {
    if (!pageFlip) return;
    if (modeBridge) {
      onModeBridgeSettled();
      return;
    }
    const idx = pageFlip.getCurrentPageIndex();
    if (state.coverPhase === "opening" && idx >= 1) finishCoverOpen();
    else if (state.coverPhase === "closing" && idx === 0) finishCoverClose();
  }

  function clearModeBridgeTimer() {
    clearTimeout(modeBridgeTimer);
    modeBridgeTimer = null;
  }

  function finishModeBridge() {
    const bridge = modeBridge;
    modeBridge = null;
    clearModeBridgeTimer();
    state.flipping = false;
    if (bridge?.onDone) bridge.onDone();
  }

  function onModeBridgeSettled() {
    if (!modeBridge || !pageFlip) return;
    const idx = pageFlip.getCurrentPageIndex();
    if (modeBridge.direction === "next" && idx >= modeBridge.targetIndex) finishModeBridge();
    else if (modeBridge.direction === "prev" && idx <= modeBridge.targetIndex) finishModeBridge();
  }

  function snapshotOutgoingPages() {
    if (pageFlip && flipHtmlPages.length) {
      const idx = Math.min(Math.max(0, pageFlip.getCurrentPageIndex()), flipHtmlPages.length - 1);
      if (isDesktop()) {
        const start = idx - (idx % 2);
        return [
          flipHtmlPages[start] || BLANK_PAGE,
          flipHtmlPages[start + 1] || BLANK_PAGE,
        ];
      }
      return [flipHtmlPages[idx] || BLANK_PAGE];
    }
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const leftHtml =
      !left || left.classList.contains("is-blank") ? BLANK_PAGE : left.innerHTML || BLANK_PAGE;
    const rightHtml = right?.innerHTML || BLANK_PAGE;
    if (isDesktop()) return [leftHtml, rightHtml];
    return [rightHtml];
  }

  function browseDestPages() {
    if (state.viewMode === "list") {
      if (!isDesktop()) {
        return [listRowsHtml(visibleRecipes()) || emptyBrowseHtml()];
      }
      if (!state.listPages.length) {
        const measure = createMeasurePageEl();
        try {
          packListPages(measure);
        } finally {
          measure.remove();
        }
      }
      clampBrowseIndex();
      return [
        state.listPages[state.browseIndex] || BLANK_PAGE,
        state.listPages[state.browseIndex + 1] || BLANK_PAGE,
      ];
    }
    const content = padEvenPages(browseContentHtmlPages());
    clampBrowseIndex();
    if (isDesktop()) {
      const start = state.browseIndex - (state.browseIndex % 2);
      return [content[start] || BLANK_PAGE, content[start + 1] || BLANK_PAGE];
    }
    return [content[state.browseIndex] || emptyBrowseHtml()];
  }

  function runModeBridge({ direction, outgoing, incoming, onDone }) {
    clearModeBridgeTimer();
    const out = (outgoing || []).length ? outgoing.slice() : [BLANK_PAGE];
    const inn = (incoming || []).length ? incoming.slice() : [BLANK_PAGE];
    let pages;
    let start;
    let targetIndex;
    if (direction === "next") {
      pages = [...out, ...inn];
      start = 0;
      targetIndex = out.length;
    } else {
      pages = [...inn, ...out];
      start = inn.length;
      targetIndex = 0;
    }
    modeBridge = { direction, targetIndex, onDone };
    mountFlipBook(pages, start, { showCover: false });
    updateChrome();

    const kick = () => {
      if (!modeBridge || !pageFlip) {
        finishModeBridge();
        return;
      }
      try {
        if (direction === "next") pageFlip.flipNext("bottom");
        else pageFlip.flipPrev("bottom");
      } catch (_) {
        finishModeBridge();
      }
    };

    requestAnimationFrame(kick);
    modeBridgeTimer = setTimeout(() => {
      if (!modeBridge) return;
      finishModeBridge();
    }, 2200);
  }

  function destroyPageFlipOnly() {
    cancelCoverSlideAnim();
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
      if (e.data === "flipping") playPageFlipSound();
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
    requestAnimationFrame(() => {
      if (options.skipCoverCenter) {
        // Stay docked at translateX(0); caller animates to center afterward.
        clearCoverCenterClasses();
      } else {
        syncCoverLayout();
        requestAnimationFrame(syncCoverLayout);
      }
    });
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
    requestAnimationFrame(() => {
      syncCoverLayout();
      requestAnimationFrame(syncCoverLayout);
    });
  }

  function bindCoverAuth() {
    const root = qs("[data-flip-slot]") || qs("[data-flip-root]");
    window.CookbookAuth.bindCoverGate(root, () => {
      openFromCover();
    });
    window.CookbookAuth.restoreGateStep?.();
  }

  function openFromCover() {
    if (state.coverPhase !== "closed") return;
    if (!window.CookbookAuth.hasChosenRole()) return;
    if (!pageFlip) return;
    state.coverPhase = "opening";
    updateChrome();

    const startFlip = () => {
      if (state.coverPhase !== "opening" || !pageFlip) return;
      try {
        pageFlip.flipNext("bottom");
      } catch (_) {
        finishCoverOpen();
      }
    };

    if (isDesktop()) {
      dockCoverFromCenter().then(startFlip);
      return;
    }
    clearCoverCenterClasses();
    startFlip();
  }

  function finishCoverOpen() {
    if (state.coverPhase !== "opening") return;
    enterOpenedHome();
  }

  function enterOpenedHome() {
    state.coverPhase = "open";
    state.browseIndex = 0;
    clearCoverCenterClasses();
    document.body.classList.remove("is-gated");
    render();
    window.CookbookUI?.mountShell?.({ active: "home" });
    applyPendingDeepLink();
    syncUrl();
  }

  function finishCoverClose() {
    if (state.coverPhase !== "closing") return;
    clearTimeout(closeFallbackTimer);
    state.coverPhase = "closed";
    document.body.classList.add("is-gated");
    // Rebuild full catalog under the cover (still on index 0) so the next open
    // flips onto page 1 instead of the leftover thin close page.
    const content = padEvenPages(browseContentHtmlPages());
    mountFlipBook([COVER_PAGE, ...content], 0, { showCover: true, skipCoverCenter: true });
    updateChrome();
    window.CookbookUI?.mountShell?.({ active: "home" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => centerCoverAfterClose());
    });
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
    state.skipModeBridge = true;
    if (pending.shopping) {
      void openShopping({ animate: false });
      return;
    }
    if (pending.edit != null) {
      const id = pending.edit === "1" || pending.edit === true ? null : pending.edit;
      void openEdit({ id, animate: false });
      return;
    }
    if (pending.manage) {
      void openManage({ animate: false });
      return;
    }
    if (pending.recipeId) {
      void openRecipe(pending.recipeId);
    } else {
      state.skipModeBridge = false;
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
            ${window.CookbookUI.thumbHtml(recipe.image, "book-preview__media")}
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
          ${window.CookbookUI.thumbHtml(recipe.image, "book-list__thumb")}
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
      blocks.push(
        `<img class="book-read__media" src="${escapeHtml(recipe.image)}" alt="" loading="lazy" decoding="async" />`
      );
    }

    (recipe.groups || []).forEach((group) => {
      const groupName = String(group.name || "").trim();
      if (groupName) {
        blocks.push(`<h2 class="book-read__section-title">${escapeHtml(groupName)}</h2>`);
      }
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
              ${window.CookbookUI.thumbHtml(ingredient?.image, "ingredient-item__thumb")}
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
    const duplicate = qs("[data-duplicate-recipe]");
    const addToCart = qs("[data-add-to-cart]");
    const filterToggle = qs("[data-filter-toggle]");
    const reading = state.mode === "reading";
    const shopping = state.mode === "shopping";
    const editing = state.mode === "editing";
    const managing = state.mode === "managing";
    const immersed = isImmersedMode();
    const coverClosed = coverIsInteractive();
    // Keep is-gated off while closing so the hard-close flip keeps open-book layout
    // (spine/stage). Gate styles apply once settled on the cover.
    const showGateShell = state.coverPhase === "closed" || state.coverPhase === "opening";
    const editBar = qs("[data-edit-bar]");
    const manageBar = qs("[data-manage-bar]");

    document.body.classList.toggle("is-reading", reading && !coverClosed);
    document.body.classList.toggle("is-shopping", shopping && !coverClosed);
    document.body.classList.toggle("is-editing", editing && !coverClosed);
    document.body.classList.toggle("is-managing", managing && !coverClosed);
    document.body.classList.toggle("is-gated", showGateShell);

    if (modes) modes.hidden = coverClosed;
    if (actions) actions.hidden = coverClosed;
    if (search) search.hidden = immersed || coverClosed;
    if (readingBar) readingBar.hidden = !reading || coverClosed;
    if (shoppingBar) shoppingBar.hidden = !shopping || coverClosed;
    if (editBar) editBar.hidden = !editing || coverClosed;
    if (manageBar) manageBar.hidden = !managing || coverClosed;
    if ((immersed || coverClosed) && state.filterOpen) closeFilterPanel();

    qsAllModeButtons().forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.viewMode;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (filterToggle) {
      const filtered = state.categoryFilters.length > 0;
      const filterOn = filtered || state.filterOpen;
      filterToggle.setAttribute("aria-pressed", filtered ? "true" : "false");
      filterToggle.setAttribute("aria-expanded", state.filterOpen ? "true" : "false");
      filterToggle.innerHTML = filterOn
        ? window.CookbookIcons.filterAltFilled({ size: 22 })
        : window.CookbookIcons.filterAlt({ size: 22 });
    }

    const favoritesBtn = qs("[data-favorites]");
    if (favoritesBtn) {
      favoritesBtn.setAttribute("aria-pressed", state.favoritesOnly ? "true" : "false");
      const favLabel = state.favoritesOnly ? "Mostrar todas as receitas" : "Mostrar favoritos";
      favoritesBtn.setAttribute("aria-label", favLabel);
      favoritesBtn.title = favLabel;
      favoritesBtn.innerHTML = state.favoritesOnly
        ? window.CookbookIcons.favoriteFilled({ size: 22 })
        : window.CookbookIcons.favorite({ size: 22 });
    }

    const visible = visibleRecipes();
    const showNav =
      !coverClosed &&
      !modeBridge &&
      ((shopping &&
        isDesktop() &&
        contentPageCount(state.shoppingPages) > pagesPerSpread()) ||
        (reading &&
          isDesktop() &&
          contentPageCount(state.readingPages) > pagesPerSpread()) ||
        (!immersed && state.viewMode === "book" && visible.length > 1) ||
        (!immersed &&
          state.viewMode === "list" &&
          isDesktop() &&
          state.listPages.length > pagesPerSpread()));

    if (prev) prev.hidden = !(showNav && canFlipPrev());
    if (next) next.hidden = !(showNav && canFlipNext());

    window.CookbookAuth.applyCookUi(document);
    if (addToCart) {
      addToCart.hidden = !(reading && !!state.readingId);
    }
    const showCookRecipeAction = reading && !!state.readingId && window.CookbookAuth.isCook();
    if (duplicate) {
      duplicate.hidden = !showCookRecipeAction;
      if (showCookRecipeAction) {
        if (isDesktop()) {
          // Use `edit?from=` (not `edit.html?from=`) so local `serve` cleanUrls
          // does not 301 to `/edit` and drop the query string.
          duplicate.href = `edit?from=${encodeURIComponent(state.readingId)}`;
        } else {
          duplicate.removeAttribute("href");
          duplicate.setAttribute("role", "button");
        }
      } else {
        duplicate.removeAttribute("href");
        duplicate.removeAttribute("role");
      }
    }
    if (edit) {
      edit.hidden = !showCookRecipeAction;
      if (showCookRecipeAction) {
        if (isDesktop()) {
          // Use `edit?id=` (not `edit.html?id=`) so local `serve` cleanUrls
          // does not 301 to `/edit` and drop the query string.
          edit.href = `edit?id=${encodeURIComponent(state.readingId)}`;
        } else {
          edit.removeAttribute("href");
          edit.setAttribute("role", "button");
        }
      } else {
        edit.removeAttribute("href");
        edit.removeAttribute("role");
      }
    }
  }

  function qsAllModeButtons() {
    return [...document.querySelectorAll("[data-book-modes] [data-view]")];
  }

  function refreshFilterCheckIcon(input) {
    const icon = input?.parentElement?.querySelector(".shopping-check__icon");
    if (!icon || !input) return;
    icon.outerHTML = window.CookbookIcons.checkboxIcon(input.checked);
  }

  function syncFilterCheckboxes() {
    const list = qs("[data-filter-list]");
    if (!list) return;
    const selected = new Set(state.categoryFilters);
    list.querySelectorAll('input[type="checkbox"][data-category-id]').forEach((input) => {
      input.checked = selected.has(input.getAttribute("data-category-id"));
      refreshFilterCheckIcon(input);
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
        (category) => {
          const on = selected.has(category.id);
          return `
      <label class="shopping-check book-filter__option">
        <input
          type="checkbox"
          data-category-id="${escapeHtml(category.id)}"
          ${on ? "checked" : ""}
        />
        ${window.CookbookIcons.checkboxIcon(on)}
        <span>${escapeHtml(category.name)}</span>
      </label>`;
        }
      )
      .join("");
    list.querySelectorAll('input[type="checkbox"][data-category-id]').forEach((input) => {
      input.addEventListener("change", () => refreshFilterCheckIcon(input));
    });
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

  async function packShoppingPages() {
    const units = (await window.CookbookShopping?.buildPageUnits?.()) || [
      `<h1 class="shopping-page__title">Lista de compras</h1>`,
      `<div class="shopping-page__empty-block">
        <p class="shopping-page__empty">Sua lista está vazia.</p>
        <button type="button" class="btn btn--primary" data-shopping-empty-add>Adicionar ingrediente</button>
      </div>`,
    ];
    const measureTarget = createMeasurePageEl();
    try {
      state.shoppingPages = padEvenPages(packHtmlUnits(units, measureTarget, "shopping-page"));
    } finally {
      measureTarget.remove();
    }
  }

  async function renderShoppingPortrait() {
    teardownFlipBook();
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const html = window.CookbookShopping?.pageShellHtml?.() || "";
    setPage(left, "", { blank: true });
    setPage(right, html, { scrollable: true });
    await fillShoppingPortraitList();
  }

  async function fillShoppingPortraitList() {
    const listRoot = document.querySelector("[data-shopping-list]");
    if (!listRoot) return;
    const units = (await window.CookbookShopping?.buildPageUnits?.()) || [];
    // units[0] is title; rest go in the list host
    listRoot.innerHTML =
      units.slice(1).join("") ||
      `<div class="shopping-page__empty-block">
        <p class="shopping-page__empty">Sua lista está vazia.</p>
        <button type="button" class="btn btn--primary" data-shopping-empty-add>Adicionar ingrediente</button>
      </div>`;
    await window.CookbookSync?.hydrateImages?.(listRoot);
  }

  async function renderShoppingFlip() {
    if (!state.shoppingPages.length) await packShoppingPages();
    clampBrowseIndex();
    refreshFlipBook(state.shoppingPages, state.shoppingPageIndex);
    await window.CookbookSync?.hydrateImages?.(document.querySelector("[data-book]") || document);
  }

  async function settleShoppingView() {
    if (state.mode !== "shopping") return;
    if (isDesktop()) {
      state.shoppingPages = [];
      state.shoppingPageIndex = 0;
      await renderShoppingFlip();
    } else {
      await renderShoppingPortrait();
    }
    updateChrome();
  }

  async function refreshShoppingContent() {
    if (state.mode !== "shopping" || modeBridge) return;
    if (isDesktop()) {
      const keep = state.shoppingPageIndex;
      state.shoppingPages = [];
      await packShoppingPages();
      state.shoppingPageIndex = keep;
      clampBrowseIndex();
      refreshFlipBook(state.shoppingPages, state.shoppingPageIndex);
      await window.CookbookSync?.hydrateImages?.(document.querySelector("[data-book]") || document);
      updateChrome();
      return;
    }
    await fillShoppingPortraitList();
  }

  function clearReadingState() {
    state.readingId = null;
    state.readingRecipe = null;
    state.readingPages = [];
    state.readingPageIndex = 0;
  }

  function clearFormModes() {
    if (state.mode === "editing") window.CookbookEditRecipe?.unmountFromBook?.();
    if (state.mode === "managing") window.CookbookManage?.unmountFromBook?.();
    state.editRecipeId = null;
    state.editRecipeFrom = null;
  }

  function renderEditingPage() {
    teardownFlipBook();
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const html = window.CookbookEditRecipe?.formShellHtml?.() || `<div class="empty">Editor indisponível.</div>`;
    setPage(left, "", { blank: true });
    setPage(right, html, { scrollable: true });
    void window.CookbookEditRecipe?.mountInBook?.(right, {
      id: state.editRecipeId,
      from: state.editRecipeFrom,
      onClose: () => closeEdit({ animate: true }),
    });
  }

  function renderManagingPage() {
    teardownFlipBook();
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const html = window.CookbookManage?.formShellHtml?.() || `<div class="empty">Gerenciar indisponível.</div>`;
    setPage(left, "", { blank: true });
    setPage(right, html, { scrollable: true });
    void window.CookbookManage?.mountInBook?.(right, {
      onClose: () => closeManage({ animate: true }),
    });
  }

  function settleEditingView() {
    if (state.mode !== "editing") return;
    renderEditingPage();
    updateChrome();
  }

  function settleManagingView() {
    if (state.mode !== "managing") return;
    renderManagingPage();
    updateChrome();
  }

  function render() {
    if (modeBridge) {
      updateChrome();
      return;
    }
    clampBrowseIndex();
    if (coverIsInteractive() && state.mode === "browse") {
      renderBrowseBook();
      updateChrome();
      return;
    }
    if (state.mode === "shopping") {
      if (isDesktop()) {
        void renderShoppingFlip();
      } else {
        renderShoppingPortrait();
      }
    } else if (state.mode === "editing") {
      renderEditingPage();
    } else if (state.mode === "managing") {
      renderManagingPage();
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
    void window.CookbookSync?.hydrateImages?.(document.querySelector("[data-book]") || document);
  }

  function flip(direction) {
    if (coverIsInteractive() || modeBridge) return;
    if (state.flipping) return;
    if (state.mode === "shopping" && !isDesktop()) return;
    if (state.mode === "editing" || state.mode === "managing") return;
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
    } else if (state.mode === "shopping") {
      state.shoppingPageIndex += direction === "next" ? step : -step;
    } else {
      state.browseIndex += direction === "next" ? step : -step;
    }
    render();
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("home");
    url.searchParams.delete("edit");
    url.searchParams.delete("manage");
    url.searchParams.delete("shopping");
    url.searchParams.delete("recipe");
    if (state.mode === "shopping") {
      url.searchParams.set("shopping", "1");
    } else if (state.mode === "editing") {
      if (state.editRecipeId) url.searchParams.set("edit", state.editRecipeId);
      else url.searchParams.set("edit", "1");
    } else if (state.mode === "managing") {
      url.searchParams.set("manage", "1");
    } else if (state.mode === "reading" && state.readingId) {
      url.searchParams.set("recipe", state.readingId);
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

  let recipeLoadGen = 0;

  async function openRecipe(id) {
    if (!id) return;
    const gen = ++recipeLoadGen;
    const stage = qs(".book__stage");
    stage?.setAttribute("aria-busy", "true");
    try {
      if (state.mode === "editing") {
        window.CookbookEditRecipe?.unmountFromBook?.();
        state.editRecipeId = null;
        state.editRecipeFrom = null;
      }
      if (state.mode === "managing") {
        window.CookbookManage?.unmountFromBook?.();
      }
      if (state.mode === "shopping") {
        state.shoppingPages = [];
        state.shoppingPageIndex = 0;
      }

      const left = qs('[data-page="left"]');
      const right = qs('[data-page="right"]');
      if (state.mode !== "reading" || state.readingId !== id) {
        teardownFlipBook();
        setPage(left, "", { blank: true });
        setPage(
          right,
          `<div class="empty" role="status" aria-live="polite">Carregando receita…</div>`,
          { scrollable: true }
        );
        updateChrome();
      }

      const recipe = await window.CookbookData.loadRecipe(id);
      if (gen !== recipeLoadGen) return;
      state.mode = "reading";
      state.readingId = id;
      state.readingRecipe = recipe;
      state.readingPageIndex = 0;
      state.readingPages = [];
      syncUrl();
      render();
      repackReadingSoon();
    } catch (err) {
      if (gen !== recipeLoadGen) return;
      teardownFlipBook();
      const host = qs('[data-page="right"]') || qs('[data-page="left"]');
      setPage(host, `<div class="empty">${escapeHtml(err.message)}</div>`);
      updateChrome();
    } finally {
      if (gen === recipeLoadGen) stage?.removeAttribute("aria-busy");
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

  async function shoppingDestPages() {
    if (isDesktop()) {
      state.shoppingPages = [];
      await packShoppingPages();
      return state.shoppingPages.slice();
    }
    return [window.CookbookShopping?.pageShellHtml?.() || BLANK_PAGE];
  }

  async function openShopping(options = {}) {
    const animate = options.animate !== false && !state.skipModeBridge && state.coverPhase === "open";
    if (state.mode === "shopping" && !modeBridge) {
      window.CookbookShopping?.ensureModals?.();
      await refreshShoppingContent();
      return;
    }
    if (state.filterOpen) closeFilterPanel();
    if (state.mode === "editing" || state.mode === "managing") clearFormModes();
    if (state.mode === "reading") clearReadingState();

    window.CookbookShopping?.removeCheckedItems?.();
    const outgoing = animate ? snapshotOutgoingPages() : null;
    state.mode = "shopping";
    state.shoppingPageIndex = 0;
    state.shoppingPages = [];
    syncUrl();
    window.CookbookShopping?.ensureModals?.();
    window.CookbookShopping?.bindChrome?.();
    window.CookbookShopping?.bindListActions?.();
    window.CookbookUI?.mountShell?.({ active: "home" });

    if (!animate) {
      state.skipModeBridge = false;
      await settleShoppingView();
      return;
    }

    const incoming = await shoppingDestPages();
    runModeBridge({
      direction: "next",
      outgoing,
      incoming,
      onDone: () => {
        void settleShoppingView();
      },
    });
  }

  function closeShopping(options = {}) {
    if (state.mode !== "shopping" || modeBridge) return;
    const animate = options.animate !== false && state.coverPhase === "open";
    const outgoing = animate ? snapshotOutgoingPages() : null;
    state.mode = "browse";
    state.shoppingPages = [];
    state.shoppingPageIndex = 0;
    syncUrl();

    if (!animate) {
      render();
      return;
    }

    const incoming = browseDestPages();
    runModeBridge({
      direction: "prev",
      outgoing,
      incoming,
      onDone: () => {
        render();
      },
    });
  }

  async function openEdit(options = {}) {
    if (isDesktop()) {
      const id = options.id;
      const from = options.from;
      if (from) {
        window.location.href = `edit?from=${encodeURIComponent(from)}`;
        return;
      }
      window.location.href = id ? `edit?id=${encodeURIComponent(id)}` : "edit.html";
      return;
    }
    if (!window.CookbookAuth?.isCook?.()) return;
    try {
      await window.CookbookUI?.ensureCookEditors?.();
    } catch (err) {
      window.alert(err?.message || "Não foi possível carregar o editor.");
      return;
    }
    const animate = options.animate !== false && !state.skipModeBridge && state.coverPhase === "open";
    if (state.filterOpen) closeFilterPanel();
    if (state.mode === "shopping") {
      state.shoppingPages = [];
      state.shoppingPageIndex = 0;
    }
    if (state.mode === "managing") window.CookbookManage?.unmountFromBook?.();
    if (state.mode === "reading") clearReadingState();

    const outgoing = animate ? snapshotOutgoingPages() : null;
    state.mode = "editing";
    state.editRecipeId = options.id || null;
    state.editRecipeFrom = state.editRecipeId ? null : options.from || null;
    syncUrl();
    window.CookbookUI?.mountShell?.({ active: "home" });

    const incoming = [window.CookbookEditRecipe?.formShellHtml?.() || BLANK_PAGE];
    if (!animate) {
      state.skipModeBridge = false;
      settleEditingView();
      return;
    }
    runModeBridge({
      direction: "next",
      outgoing,
      incoming,
      onDone: () => settleEditingView(),
    });
  }

  function closeEdit(options = {}) {
    if (state.mode !== "editing" || modeBridge) return;
    const animate = options.animate !== false && state.coverPhase === "open";
    const outgoing = animate ? snapshotOutgoingPages() : null;
    window.CookbookEditRecipe?.unmountFromBook?.();
    state.mode = "browse";
    state.editRecipeId = null;
    state.editRecipeFrom = null;
    syncUrl();
    if (!animate) {
      render();
      return;
    }
    runModeBridge({
      direction: "prev",
      outgoing,
      incoming: browseDestPages(),
      onDone: () => render(),
    });
  }

  async function openManage(options = {}) {
    if (isDesktop()) {
      window.location.href = "manage.html";
      return;
    }
    if (!window.CookbookAuth?.isCook?.()) return;
    try {
      await window.CookbookUI?.ensureCookEditors?.();
    } catch (err) {
      window.alert(err?.message || "Não foi possível carregar o gerenciador.");
      return;
    }
    const animate = options.animate !== false && !state.skipModeBridge && state.coverPhase === "open";
    if (state.filterOpen) closeFilterPanel();
    if (state.mode === "shopping") {
      state.shoppingPages = [];
      state.shoppingPageIndex = 0;
    }
    if (state.mode === "editing") window.CookbookEditRecipe?.unmountFromBook?.();
    if (state.mode === "reading") clearReadingState();

    const outgoing = animate ? snapshotOutgoingPages() : null;
    state.mode = "managing";
    syncUrl();
    window.CookbookUI?.mountShell?.({ active: "home" });

    const incoming = [window.CookbookManage?.formShellHtml?.() || BLANK_PAGE];
    if (!animate) {
      state.skipModeBridge = false;
      settleManagingView();
      return;
    }
    runModeBridge({
      direction: "next",
      outgoing,
      incoming,
      onDone: () => settleManagingView(),
    });
  }

  async function refreshCatalog() {
    try {
      const [measures, ingredients] = await Promise.all([
        window.CookbookData.loadMeasures(),
        window.CookbookData.loadIngredientIndex(),
      ]);
      state.measures = measures || [];
      state.ingredients = ingredients || [];
    } catch (_) {
      /* keep existing catalog */
    }
  }

  function closeManage(options = {}) {
    if (state.mode !== "managing" || modeBridge) return;
    const animate = options.animate !== false && state.coverPhase === "open";
    const outgoing = animate ? snapshotOutgoingPages() : null;
    window.CookbookManage?.unmountFromBook?.();
    state.mode = "browse";
    syncUrl();
    void refreshCatalog().then(() => {
      if (!animate) {
        render();
        return;
      }
      runModeBridge({
        direction: "prev",
        outgoing,
        incoming: browseDestPages(),
        onDone: () => render(),
      });
    });
  }

  function goHome() {
    if (state.coverPhase !== "open") return false;
    if (state.filterOpen) closeFilterPanel();
    if (modeBridge) return true;
    state.browseIndex = 0;
    if (state.mode === "shopping") {
      closeShopping({ animate: true });
      return true;
    }
    if (state.mode === "editing") {
      closeEdit({ animate: true });
      return true;
    }
    if (state.mode === "managing") {
      closeManage({ animate: true });
      return true;
    }
    if (state.mode === "reading") {
      clearReadingState();
      state.mode = "browse";
    }
    syncUrl();
    render();
    return true;
  }

  function setViewMode(mode) {
    if (mode !== "book" && mode !== "list") return;
    if (coverIsInteractive()) return;
    if (isImmersedMode()) return;
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
    e.stopImmediatePropagation();
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
    qs("[data-edit-back]")?.addEventListener("click", () => {
      if (window.CookbookEditRecipe?.attemptClose) {
        window.CookbookEditRecipe.attemptClose();
        return;
      }
      closeEdit({ animate: true });
    });
    qs("[data-manage-back]")?.addEventListener("click", () => closeManage({ animate: true }));
    qs("[data-edit]")?.addEventListener("click", (e) => {
      if (isDesktop() || !state.readingId) return;
      e.preventDefault();
      void openEdit({ id: state.readingId, animate: true });
    });
    qs("[data-duplicate-recipe]")?.addEventListener("click", (e) => {
      if (isDesktop() || !state.readingId) return;
      e.preventDefault();
      void openEdit({ from: state.readingId, animate: true });
    });
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
    const filterReset = qs("[data-filter-reset]");
    if (filterReset) {
      filterReset.innerHTML = window.CookbookIcons.mop();
      filterReset.addEventListener("click", resetFilters);
    }
    const filterApply = qs("[data-filter-apply]");
    if (filterApply) {
      filterApply.innerHTML = window.CookbookIcons.check();
      filterApply.addEventListener("click", applyFilters);
    }
    qs("[data-favorites]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavoritesFilter();
    });
    qs("[data-spread]")?.addEventListener("click", onFavoriteClick);
    qs("[data-flip-slot]")?.addEventListener("click", onFavoriteClick);
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-empty-new-recipe]")) {
        e.preventDefault();
        void openEdit({ animate: true });
        return;
      }
      if (e.target.closest("[data-clear-browse-filters]")) {
        e.preventDefault();
        state.categoryFilters = [];
        state.favoritesOnly = false;
        state.searchQuery = "";
        const search = qs("[data-recipe-search]");
        if (search) search.value = "";
        state.browseIndex = 0;
        state.listPages = [];
        syncFilterCheckboxes();
        closeFilterPanel();
        render();
        updateChrome();
      }
    });
    bindFlipGestures();
    qs("[data-filter-panel]")?.addEventListener("click", (e) => e.stopPropagation());
    qs("[data-recipe-search]")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value || "";
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.browseIndex = 0;
        state.listPages = [];
        render();
      }, 200);
    });

    document.addEventListener("click", () => {
      if (!state.filterOpen) return;
      closeFilterPanel();
      updateChrome();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (window.CookbookShopping?.hasOpenModal?.()) return;
        if (document.querySelector(".shopping-modal:not([hidden])")) return;
        if (state.filterOpen) {
          closeFilterPanel();
          updateChrome();
          return;
        }
        if (state.mode === "shopping") {
          closeShopping({ animate: true });
          return;
        }
        if (state.mode === "editing") {
          if (window.CookbookEditRecipe?.attemptClose) {
            window.CookbookEditRecipe.attemptClose();
          } else {
            closeEdit({ animate: true });
          }
          return;
        }
        if (state.mode === "managing") {
          closeManage({ animate: true });
          return;
        }
        if (state.mode === "reading") {
          closeReading();
          return;
        }
      }
      if (coverIsInteractive() || modeBridge || state.mode === "editing" || state.mode === "managing") {
        return;
      }
      if (state.mode === "shopping" && !isDesktop()) return;
      if (e.key === "ArrowLeft") flip("prev");
      if (e.key === "ArrowRight") flip("next");
    });

    lastResizeLayout = { width: window.innerWidth, desktop: isDesktop() };
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const desktop = isDesktop();
        const width = window.innerWidth;
        // Soft keyboard changes height only; skip remount so focused inputs stay.
        if (
          lastResizeLayout &&
          lastResizeLayout.width === width &&
          lastResizeLayout.desktop === desktop
        ) {
          return;
        }
        lastResizeLayout = { width, desktop };
        if (state.mode === "reading") state.readingPages = [];
        if (state.mode === "shopping") state.shoppingPages = [];
        if (state.viewMode === "list") state.listPages = [];
        if (usesFlipBook()) lastFlipSize = null;
        render();
      }, 120);
    });
  }

  async function start({ recipes, categories }) {
    state.recipes = window.CookbookData.sortByName(recipes || [], "title");
    state.categories = window.CookbookData.sortByName(categories || []);
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
    const skipCover = window.CookbookAuth.wantsOpenedEntry();
    const opened = window.CookbookAuth.consumeOpenedEntry();
    const editParam = params.get("edit");
    state.pendingDeepLink = {
      recipeId: params.get("recipe"),
      shopping: params.get("shopping") === "1" || opened.shopping,
      edit: editParam,
      manage: params.get("manage") === "1",
    };

    if (skipCover) {
      enterOpenedHome();
      return;
    }

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
    openEdit,
    closeEdit,
    openManage,
    closeManage,
    refreshShoppingContent,
    goHome,
    closeToCover,
    openFromCover,
  };
})();
