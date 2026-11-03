(function () {
  const VIEW_KEY = "mycookbook_view_mode";
  const DESKTOP_MQ = "(min-width: 800px)";
  const FLIP_MS = 160;
  const BLANK_PAGE = `<div class="book-read book-read--blank" aria-hidden="true"></div>`;
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
  };

  let flipTimer = null;
  let resizeTimer = null;

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function isDesktop() {
    return window.matchMedia(DESKTOP_MQ).matches;
  }

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function categoryName(id) {
    return state.categories.find((c) => c.id === id)?.name || id || "Uncategorized";
  }

  function favoritesStorageKey() {
    return window.CookbookConfig?.storageKeys?.favorites || "mycookbook_favorites";
  }

  function favoritesCookCacheKey() {
    return window.CookbookConfig?.storageKeys?.favoritesCookCache || "mycookbook_favorites_cook";
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
    if (window.CookbookAuth.isCook()) {
      writeLocalFavoriteIds(favoritesCookCacheKey(), state.favoriteIds);
    } else {
      writeLocalFavoriteIds(favoritesStorageKey(), state.favoriteIds);
    }
  }

  function loadVisitorFavorites() {
    state.favoriteIds = new Set(readLocalFavoriteIds(favoritesStorageKey()));
  }

  function hasLocalKey(key) {
    try {
      return localStorage.getItem(key) !== null;
    } catch (_) {
      return false;
    }
  }

  async function loadCookFavorites() {
    const token = window.CookbookAuth.getToken();
    const cacheKey = favoritesCookCacheKey();
    let remoteIds = [];
    let missing = false;

    try {
      const file = await window.CookbookGitHub.getFile("data/favorites.json", token);
      if (!file) {
        missing = true;
      } else {
        const text = window.CookbookGitHub.decodeContent(file);
        remoteIds = parseFavoriteIds(JSON.parse(text || "[]"));
      }
    } catch (_) {
      state.favoriteIds = new Set(readLocalFavoriteIds(cacheKey));
      return;
    }

    // One-time migrate: empty/missing remote and no cook cache yet → seed from visitor local.
    if ((missing || remoteIds.length === 0) && !hasLocalKey(cacheKey)) {
      const seedSource = readLocalFavoriteIds(favoritesStorageKey());
      if (seedSource.length > 0) {
        state.favoriteIds = new Set(seedSource);
        writeLocalFavoriteIds(cacheKey, state.favoriteIds);
        try {
          await window.CookbookGitHub.putJsonFile(
            "data/favorites.json",
            [...state.favoriteIds],
            "Seed favorites",
            token
          );
        } catch (_) {
          /* keep local cache; sync on next toggle */
        }
        return;
      }
    }

    state.favoriteIds = new Set(remoteIds);
    writeLocalFavoriteIds(cacheKey, state.favoriteIds);
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
    const label = on ? "Remove from favorites" : "Add to favorites";
    const cls = extraClass ? `favorite-btn ${extraClass}` : "favorite-btn";
    return `<button type="button" class="${cls}" data-favorite-toggle="${escapeHtml(recipeId)}" aria-pressed="${on ? "true" : "false"}" title="${label}" aria-label="${label}">${HEART_SVG}</button>`;
  }

  function syncFavoriteButtons() {
    document.querySelectorAll("[data-favorite-toggle]").forEach((btn) => {
      const id = btn.getAttribute("data-favorite-toggle");
      const on = isFavorite(id);
      const label = on ? "Remove from favorites" : "Add to favorites";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", label);
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

  async function toggleFavorite(id) {
    if (!id) return;
    const wasOn = state.favoriteIds.has(id);
    if (wasOn) state.favoriteIds.delete(id);
    else state.favoriteIds.add(id);

    saveFavoritesLocal();
    refreshFavoriteUi();

    if (!window.CookbookAuth.isCook()) return;

    try {
      await window.CookbookGitHub.putJsonFile(
        "data/favorites.json",
        [...state.favoriteIds],
        "Update favorites",
        window.CookbookAuth.getToken()
      );
    } catch (err) {
      if (wasOn) state.favoriteIds.add(id);
      else state.favoriteIds.delete(id);
      saveFavoritesLocal();
      refreshFavoriteUi();
      window.alert(err.message || "Could not sync favorites.");
    }
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
        return `<div class="empty">No favorite recipes yet.</div>`;
      }
      return `<div class="empty">No recipes match these filters.</div>`;
    }
    return `<div class="empty">No recipes yet.</div>`;
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

  function padEvenPages(pages) {
    const list = pages.slice();
    if (!list.length) list.push(BLANK_PAGE);
    if (list.length % 2 === 1) list.push(BLANK_PAGE);
    return list;
  }

  function clampBrowseIndex() {
    const step = pagesPerSpread();
    if (state.mode === "reading") {
      if (!isDesktop()) {
        state.readingPageIndex = 0;
        return;
      }
      const max = Math.max(0, state.readingPages.length - step);
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
      const max = Math.max(0, visibleRecipes().length - 1);
      let idx = Math.min(Math.max(0, state.browseIndex), max);
      if (isDesktop()) idx -= idx % 2;
      state.browseIndex = idx;
      return;
    }
    state.browseIndex = 0;
  }

  function canFlipPrev() {
    if (state.mode === "reading") {
      return isDesktop() && state.readingPageIndex > 0;
    }
    if (state.viewMode === "list") {
      return isDesktop() && state.browseIndex > 0;
    }
    return state.browseIndex > 0;
  }

  function canFlipNext() {
    const step = pagesPerSpread();
    if (state.mode === "reading") {
      return isDesktop() && state.readingPageIndex + step < state.readingPages.length;
    }
    if (state.viewMode === "list") {
      return isDesktop() && state.browseIndex + step < state.listPages.length;
    }
    return state.browseIndex + step < visibleRecipes().length;
  }

  function previewHtml(recipe) {
    if (!recipe) return "";
    const id = escapeHtml(recipe.id);
    const title = escapeHtml(recipe.title);
    return `
      <div class="book-preview">
        <div class="book-preview__media-wrap">
          <button type="button" class="book-preview__media-btn" data-open-recipe="${id}" aria-label="Open ${title}">
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
      blocks.push(`<h2 class="book-read__section-title">${escapeHtml(group.name || "Section")}</h2>`);
      blocks.push(`<p class="book-read__label">Ingredients</p>`);
      const lines = group.ingredients || [];
      if (!lines.length) {
        blocks.push(`<p>None listed.</p>`);
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
      blocks.push(`<p class="book-read__label">Steps</p>`);
      const steps = group.steps || [];
      if (!steps.length) {
        blocks.push(`<p>No steps yet.</p>`);
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
    const prev = qs("[data-prev]");
    const next = qs("[data-next]");
    const edit = qs("[data-edit]");
    const filterToggle = qs("[data-filter-toggle]");
    const reading = state.mode === "reading";

    document.body.classList.toggle("is-reading", reading);

    if (modes) modes.hidden = reading;
    if (actions) actions.hidden = reading;
    if (search) search.hidden = reading;
    if (readingBar) readingBar.hidden = !reading;
    if (reading && state.filterOpen) closeFilterPanel();

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
      const favLabel = state.favoritesOnly ? "Show all recipes" : "Show favorites";
      favoritesBtn.setAttribute("aria-label", favLabel);
      favoritesBtn.title = favLabel;
    }

    const visible = visibleRecipes();
    const showNav =
      (reading && isDesktop() && state.readingPages.length > pagesPerSpread()) ||
      (!reading && state.viewMode === "book" && visible.length > pagesPerSpread()) ||
      (!reading &&
        state.viewMode === "list" &&
        isDesktop() &&
        state.listPages.length > pagesPerSpread());

    if (prev) prev.hidden = !(showNav && canFlipPrev());
    if (next) next.hidden = !(showNav && canFlipNext());

    window.CookbookAuth.applyCookUi(document);
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
      list.innerHTML = `<p class="book-filter__empty">No categories yet.</p>`;
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
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const recipes = visibleRecipes();

    if (isDesktop()) {
      const leftRecipe = recipes[state.browseIndex];
      const rightRecipe = recipes[state.browseIndex + 1];
      setPage(left, leftRecipe ? previewHtml(leftRecipe) : "", { blank: !leftRecipe });
      setPage(right, rightRecipe ? previewHtml(rightRecipe) : "", { blank: !rightRecipe });
      if (!leftRecipe && !rightRecipe) {
        setPage(left, emptyBrowseHtml());
      }
    } else {
      const recipe = recipes[state.browseIndex];
      setPage(left, "", { blank: true });
      setPage(right, recipe ? previewHtml(recipe) : emptyBrowseHtml(), {
        blank: !recipe,
      });
    }
    bindOpenHandlers(qs("[data-spread]"));
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

  function renderReadingDesktop() {
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    if (!state.readingPages.length) {
      const measureTarget = right?.clientWidth > 40 ? right : left;
      const blocks = buildReadingBlocks(state.readingRecipe);
      state.readingPages = packBlocks(blocks, measureTarget);
      clampBrowseIndex();
    }
    const leftHtml = state.readingPages[state.readingPageIndex] || "";
    const rightHtml = state.readingPages[state.readingPageIndex + 1] || "";
    setPage(left, leftHtml, { blank: !leftHtml || leftHtml === BLANK_PAGE });
    setPage(right, rightHtml, { blank: !rightHtml || rightHtml === BLANK_PAGE });
  }

  function render() {
    clampBrowseIndex();
    if (state.mode === "reading" && state.readingRecipe) {
      if (isDesktop()) renderReadingDesktop();
      else renderReadingPhone();
    } else if (state.viewMode === "list") {
      renderBrowseList();
    } else {
      renderBrowseBook();
    }
    updateChrome();
  }

  function animateFlip(direction, then) {
    const spread = qs("[data-spread]");
    if (!spread || reduceMotion()) {
      then();
      return;
    }

    state.flipping = true;
    spread.classList.remove("is-flipping", "is-flipping-forward");
    void spread.offsetWidth;
    spread.classList.add("is-flipping");
    if (direction === "next") spread.classList.add("is-flipping-forward");

    clearTimeout(flipTimer);
    flipTimer = setTimeout(() => {
      then();
      spread.classList.remove("is-flipping", "is-flipping-forward");
      state.flipping = false;
    }, FLIP_MS);
  }

  function flip(direction) {
    if (state.flipping) return;
    if (direction === "prev" && !canFlipPrev()) return;
    if (direction === "next" && !canFlipNext()) return;
    const step = pagesPerSpread();
    animateFlip(direction, () => {
      if (state.mode === "reading") {
        state.readingPageIndex += direction === "next" ? step : -step;
      } else {
        state.browseIndex += direction === "next" ? step : -step;
      }
      render();
    });
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    if (state.mode === "reading" && state.readingId) {
      url.searchParams.set("recipe", state.readingId);
    } else {
      url.searchParams.delete("recipe");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function repackReadingSoon() {
    if (!isDesktop() || state.mode !== "reading") return;
    requestAnimationFrame(() => {
      state.readingPages = [];
      render();
      qs("[data-spread]")
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
      const host = isDesktop() ? qs('[data-page="left"]') : qs('[data-page="right"]');
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

  function setViewMode(mode) {
    if (mode !== "book" && mode !== "list") return;
    if (state.mode === "reading") return;
    state.viewMode = mode;
    state.browseIndex = 0;
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch (_) {
      /* ignore */
    }
    render();
  }

  function bindSwipe() {
    const spread = qs("[data-spread]");
    if (!spread) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    spread.addEventListener(
      "touchstart",
      (e) => {
        if (state.mode !== "browse" || state.viewMode !== "book" || isDesktop() || state.flipping) return;
        const t = e.changedTouches[0];
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
      },
      { passive: true }
    );

    spread.addEventListener(
      "touchend",
      (e) => {
        if (!tracking) return;
        tracking = false;
        if (state.mode !== "browse" || state.viewMode !== "book" || isDesktop()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
        if (dx < 0) flip("next");
        else flip("prev");
      },
      { passive: true }
    );
  }

  function bindUi() {
    qsAllModeButtons().forEach((btn) => {
      btn.addEventListener("click", () => setViewMode(btn.getAttribute("data-view")));
    });
    qs("[data-prev]")?.addEventListener("click", () => flip("prev"));
    qs("[data-next]")?.addEventListener("click", () => flip("next"));
    qs("[data-back]")?.addEventListener("click", closeReading);
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
    qs("[data-spread]")?.addEventListener("click", (e) => {
      const fav = e.target.closest("[data-favorite-toggle]");
      if (!fav) return;
      e.preventDefault();
      e.stopPropagation();
      void toggleFavorite(fav.getAttribute("data-favorite-toggle"));
    });
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
        if (state.filterOpen) {
          closeFilterPanel();
          updateChrome();
          return;
        }
        if (state.mode === "reading") {
          closeReading();
          return;
        }
      }
      if (e.key === "ArrowLeft") flip("prev");
      if (e.key === "ArrowRight") flip("next");
    });

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.mode === "reading") state.readingPages = [];
        if (state.viewMode === "list") state.listPages = [];
        render();
      }, 120);
    });

    bindSwipe();
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

    const recipeId = new URLSearchParams(window.location.search).get("recipe");
    render();
    if (recipeId) await openRecipe(recipeId);
  }

  window.CookbookBook = { start, openRecipe, closeReading };
})();
