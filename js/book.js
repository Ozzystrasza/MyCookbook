(function () {
  const VIEW_KEY = "mycookbook_view_mode";
  const DESKTOP_MQ = "(min-width: 800px)";
  const FLIP_MS = 380;
  const BLANK_PAGE = `<div class="book-read book-read--blank" aria-hidden="true"></div>`;

  const state = {
    recipes: [],
    categories: [],
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
      const max = Math.max(0, state.recipes.length - 1);
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
    return state.browseIndex + step < state.recipes.length;
  }

  function previewHtml(recipe) {
    if (!recipe) return "";
    return `
      <button type="button" class="book-preview" data-open-recipe="${escapeHtml(recipe.id)}">
        <img class="book-preview__media" src="${escapeHtml(recipe.image || "")}" alt="" />
        <p class="book-preview__category">${escapeHtml(categoryName(recipe.categoryId))}</p>
        <h2 class="book-preview__title">${escapeHtml(recipe.title)}</h2>
      </button>`;
  }

  function listRowHtml(recipe) {
    return `
      <button type="button" class="book-list__row" data-open-recipe="${escapeHtml(recipe.id)}">
        <img class="book-list__thumb" src="${escapeHtml(recipe.image || "")}" alt="" />
        <div class="book-list__meta">
          <p class="book-list__category">${escapeHtml(categoryName(recipe.categoryId))}</p>
          <h3 class="book-list__title">${escapeHtml(recipe.title)}</h3>
        </div>
      </button>`;
  }

  function listRowsHtml(recipes) {
    if (!recipes.length) return `<div class="empty">No recipes yet.</div>`;
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

    blocks.push(`<p class="book-read__eyebrow">${escapeHtml(category)}</p>`);
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
    if (!state.recipes.length) {
      state.listPages = padEvenPages([`<div class="empty">No recipes yet.</div>`]);
      return;
    }
    state.listPages = padEvenPages(
      packHtmlUnits(
        state.recipes.map((recipe) => listRowHtml(recipe)),
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
    const readingBar = qs("[data-reading-bar]");
    const prev = qs("[data-prev]");
    const next = qs("[data-next]");
    const edit = qs("[data-edit]");
    const reading = state.mode === "reading";

    document.body.classList.toggle("is-reading", reading);

    if (modes) modes.hidden = reading;
    if (readingBar) readingBar.hidden = !reading;

    qsAllModeButtons().forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.viewMode;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const showNav =
      (reading && isDesktop() && state.readingPages.length > pagesPerSpread()) ||
      (!reading && state.viewMode === "book" && state.recipes.length > pagesPerSpread()) ||
      (!reading &&
        state.viewMode === "list" &&
        isDesktop() &&
        state.listPages.length > pagesPerSpread());

    if (prev) prev.hidden = !(showNav && canFlipPrev());
    if (next) next.hidden = !(showNav && canFlipNext());

    window.CookbookAuth.applyCookUi(document);
    if (edit) {
      const showEdit = reading && state.readingId && window.CookbookAuth.isCook();
      edit.hidden = !showEdit;
      if (showEdit) edit.href = `edit.html?id=${encodeURIComponent(state.readingId)}`;
    }
  }

  function qsAllModeButtons() {
    return [...document.querySelectorAll("[data-book-modes] [data-view]")];
  }

  function renderBrowseBook() {
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');

    if (isDesktop()) {
      const leftRecipe = state.recipes[state.browseIndex];
      const rightRecipe = state.recipes[state.browseIndex + 1];
      setPage(left, leftRecipe ? previewHtml(leftRecipe) : "", { blank: !leftRecipe });
      setPage(right, rightRecipe ? previewHtml(rightRecipe) : "", { blank: !rightRecipe });
      if (!leftRecipe && !rightRecipe) {
        setPage(left, `<div class="empty">No recipes yet.</div>`);
      }
    } else {
      const recipe = state.recipes[state.browseIndex];
      setPage(left, "", { blank: true });
      setPage(right, recipe ? previewHtml(recipe) : `<div class="empty">No recipes yet.</div>`, {
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
      setPage(right, listRowsHtml(state.recipes), { scrollable: true });
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
    // Desktop: next turns right leaf toward spine; prev turns left leaf.
    // Phone: only the right leaf is readable, so it always turns.
    const turning = !isDesktop()
      ? qs('[data-page="right"]')
      : direction === "next"
        ? qs('[data-page="right"]')
        : qs('[data-page="left"]');

    spread.classList.remove("is-flipping", "is-flipping-next", "is-flipping-prev");
    qs('[data-page="left"]')?.classList.remove("is-turning");
    qs('[data-page="right"]')?.classList.remove("is-turning");
    void spread.offsetWidth;

    spread.classList.add("is-flipping", direction === "next" ? "is-flipping-next" : "is-flipping-prev");
    turning?.classList.add("is-turning");

    clearTimeout(flipTimer);
    flipTimer = setTimeout(() => {
      then();
      spread.classList.remove("is-flipping", "is-flipping-next", "is-flipping-prev");
      qs('[data-page="left"]')?.classList.remove("is-turning");
      qs('[data-page="right"]')?.classList.remove("is-turning");
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

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.mode === "reading") {
        closeReading();
        return;
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
    state.recipes = recipes || [];
    state.categories = categories || [];
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "book" || saved === "list") state.viewMode = saved;
    } catch (_) {
      /* ignore */
    }

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
