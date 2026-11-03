(function () {
  let measuresCache = null;
  let ingredientsCache = null;
  let panelEl = null;
  let catalogEl = null;
  let recipeEl = null;

  function storageKey() {
    return window.CookbookConfig.storageKeys.shoppingList;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadList() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.ingredientId === "string")
        .map((item) => ({
          ingredientId: item.ingredientId,
          quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
          checked: Boolean(item.checked),
          amounts: Array.isArray(item.amounts)
            ? item.amounts
                .filter((a) => a && a.measureId)
                .map((a) => ({
                  quantity: a.quantity == null ? "" : String(a.quantity),
                  measureId: String(a.measureId),
                }))
            : [],
        }));
    } catch {
      return [];
    }
  }

  function saveList(list) {
    localStorage.setItem(storageKey(), JSON.stringify(list));
  }

  function parseNumericQty(value) {
    const s = String(value ?? "").trim().replace(",", ".");
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) {
      const den = Number(frac[2]);
      if (!den) return null;
      return Number(frac[1]) / den;
    }
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const den = Number(mixed[3]);
      if (!den) return null;
      return Number(mixed[1]) + Number(mixed[2]) / den;
    }
    return null;
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "";
    if (Number.isInteger(n)) return String(n);
    const rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }

  function mergeAmountInto(amounts, incoming) {
    const measureId = incoming.measureId;
    if (!measureId) return amounts;
    const qtyStr = incoming.quantity == null ? "" : String(incoming.quantity);
    const idx = amounts.findIndex((a) => a.measureId === measureId);
    if (idx === -1) {
      amounts.push({ quantity: qtyStr, measureId });
      return amounts;
    }
    const existing = amounts[idx];
    const a = parseNumericQty(existing.quantity);
    const b = parseNumericQty(qtyStr);
    if (a != null && b != null) {
      amounts[idx] = { quantity: formatNumber(a + b), measureId };
    } else if (!existing.quantity && qtyStr) {
      amounts[idx] = { quantity: qtyStr, measureId };
    }
    return amounts;
  }

  function addRecipeLines(lines) {
    const list = loadList();
    const byId = new Map(list.map((item) => [item.ingredientId, item]));
    (lines || []).forEach((line) => {
      if (!line?.ingredientId) return;
      let item = byId.get(line.ingredientId);
      if (!item) {
        item = {
          ingredientId: line.ingredientId,
          quantity: 1,
          checked: false,
          amounts: [],
        };
        list.push(item);
        byId.set(line.ingredientId, item);
      }
      mergeAmountInto(item.amounts, {
        quantity: line.quantity,
        measureId: line.measureId,
      });
    });
    saveList(list);
    return list;
  }

  function addManual(ingredientId) {
    if (!ingredientId) return loadList();
    const list = loadList();
    const existing = list.find((item) => item.ingredientId === ingredientId);
    if (existing) {
      existing.quantity += 1;
    } else {
      list.push({
        ingredientId,
        quantity: 1,
        checked: false,
        amounts: [],
      });
    }
    saveList(list);
    return list;
  }

  function setChecked(ingredientId, checked) {
    const list = loadList();
    const item = list.find((entry) => entry.ingredientId === ingredientId);
    if (!item) return list;
    item.checked = Boolean(checked);
    saveList(list);
    return list;
  }

  function adjustQuantity(ingredientId, delta) {
    const list = loadList();
    const idx = list.findIndex((entry) => entry.ingredientId === ingredientId);
    if (idx === -1) return list;
    list[idx].quantity += delta;
    if (list[idx].quantity <= 0) list.splice(idx, 1);
    saveList(list);
    return list;
  }

  function clearList() {
    saveList([]);
    return [];
  }

  async function ensureData() {
    if (!measuresCache || !ingredientsCache) {
      const [measures, ingredients] = await Promise.all([
        window.CookbookData.loadMeasures(),
        window.CookbookData.loadIngredientIndex(),
      ]);
      measuresCache = Object.fromEntries((measures || []).map((m) => [m.id, m]));
      ingredientsCache = Object.fromEntries((ingredients || []).map((i) => [i.id, i]));
    }
    return { measures: measuresCache, ingredients: ingredientsCache };
  }

  function formatAmounts(amounts, measures) {
    if (!amounts?.length) return "";
    return amounts
      .map((a) => window.CookbookData.formatQuantity(a.quantity, measures[a.measureId]))
      .filter(Boolean)
      .join(" + ");
  }

  function ensureShell() {
    if (panelEl) return;

    panelEl = document.createElement("div");
    panelEl.className = "shopping-panel";
    panelEl.hidden = true;
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-label", "Lista de compras");
    panelEl.innerHTML = `
      <div class="shopping-panel__header">
        <h2 class="shopping-panel__title">Lista de compras</h2>
        <button type="button" class="btn btn--ghost btn--small" data-shopping-clear>Limpar lista</button>
      </div>
      <div class="shopping-panel__list" data-shopping-list></div>
      <div class="shopping-panel__footer">
        <button type="button" class="btn btn--primary" data-shopping-add>+</button>
      </div>
    `;
    document.body.appendChild(panelEl);

    catalogEl = document.createElement("div");
    catalogEl.className = "shopping-modal";
    catalogEl.hidden = true;
    catalogEl.innerHTML = `
      <div class="shopping-modal__backdrop" data-catalog-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-label="Adicionar ingrediente">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title">Adicionar ingrediente</h2>
          <button type="button" class="icon-btn" data-catalog-close aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <label class="shopping-modal__search">
          <span class="visually-hidden">Buscar ingrediente</span>
          <input type="search" data-catalog-search placeholder="Buscar no catálogo" autocomplete="off" />
        </label>
        <div class="shopping-modal__list" data-catalog-list></div>
      </div>
    `;
    document.body.appendChild(catalogEl);

    recipeEl = document.createElement("div");
    recipeEl.className = "shopping-modal";
    recipeEl.hidden = true;
    recipeEl.innerHTML = `
      <div class="shopping-modal__backdrop" data-recipe-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-label="Adicionar à lista">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title">Adicionar à lista</h2>
          <button type="button" class="icon-btn" data-recipe-close aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <label class="shopping-check shopping-check--all">
          <input type="checkbox" data-recipe-check-all checked />
          <span class="shopping-check__box" aria-hidden="true"></span>
          <span>Selecionar todos</span>
        </label>
        <div class="shopping-modal__list" data-recipe-list></div>
        <div class="shopping-modal__footer">
          <button type="button" class="btn btn--primary" data-recipe-confirm>Adicionar ao carrinho</button>
        </div>
      </div>
    `;
    document.body.appendChild(recipeEl);

    panelEl.querySelector("[data-shopping-clear]")?.addEventListener("click", () => {
      clearList();
      renderPanel();
    });
    panelEl.querySelector("[data-shopping-add]")?.addEventListener("click", () => {
      openCatalogPicker();
    });
    panelEl.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-shopping-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-shopping-action");
      if (!id || !action) return;
      if (action === "toggle") {
        const checked = btn.getAttribute("aria-pressed") !== "true";
        setChecked(id, checked);
      } else if (action === "inc") {
        adjustQuantity(id, 1);
      } else if (action === "dec") {
        adjustQuantity(id, -1);
      }
      renderPanel();
    });

    catalogEl.querySelectorAll("[data-catalog-close]").forEach((el) => {
      el.addEventListener("click", closeCatalogPicker);
    });
    catalogEl.querySelector("[data-catalog-search]")?.addEventListener("input", () => {
      renderCatalogList();
    });
    catalogEl.querySelector("[data-catalog-list]")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-catalog-pick]");
      if (!btn) return;
      addManual(btn.getAttribute("data-catalog-pick"));
      closeCatalogPicker();
      openPanel();
      renderPanel();
    });

    recipeEl.querySelectorAll("[data-recipe-close]").forEach((el) => {
      el.addEventListener("click", closeRecipePicker);
    });
    recipeEl.querySelector("[data-recipe-check-all]")?.addEventListener("change", (event) => {
      const on = event.target.checked;
      recipeEl.querySelectorAll('[data-recipe-list] input[type="checkbox"]').forEach((input) => {
        input.checked = on;
      });
    });
    recipeEl.querySelector("[data-recipe-list]")?.addEventListener("change", () => {
      syncRecipeCheckAll();
    });
    recipeEl.querySelector("[data-recipe-confirm]")?.addEventListener("click", () => {
      const lines = [];
      recipeEl.querySelectorAll("[data-recipe-line]").forEach((row) => {
        const input = row.querySelector('input[type="checkbox"]');
        if (!input?.checked) return;
        lines.push({
          ingredientId: row.getAttribute("data-ingredient-id"),
          measureId: row.getAttribute("data-measure-id"),
          quantity: row.getAttribute("data-quantity") || "",
        });
      });
      addRecipeLines(lines);
      closeRecipePicker();
      openPanel();
      renderPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!catalogEl.hidden) closeCatalogPicker();
      else if (!recipeEl.hidden) closeRecipePicker();
      else if (!panelEl.hidden) closePanel();
    });

    document.addEventListener("click", (event) => {
      if (panelEl.hidden) return;
      if (panelEl.contains(event.target)) return;
      if (event.target.closest("[data-shopping-toggle]")) return;
      if (!catalogEl.hidden || !recipeEl.hidden) return;
      closePanel();
    });
  }

  async function renderPanel() {
    ensureShell();
    const listRoot = panelEl.querySelector("[data-shopping-list]");
    if (!listRoot) return;
    const { measures, ingredients } = await ensureData();
    const list = loadList();
    if (!list.length) {
      listRoot.innerHTML = `<p class="shopping-panel__empty">Sua lista está vazia.</p>`;
      return;
    }
    listRoot.innerHTML = list
      .map((item) => {
        const ing = ingredients[item.ingredientId];
        const name = ing?.name || item.ingredientId;
        const image = ing?.image || "";
        const amountText = formatAmounts(item.amounts, measures);
        const checked = item.checked;
        return `
          <div class="shopping-row${checked ? " is-checked" : ""}">
            <button
              type="button"
              class="shopping-check-btn"
              data-shopping-action="toggle"
              data-id="${escapeHtml(item.ingredientId)}"
              aria-pressed="${checked ? "true" : "false"}"
              aria-label="${checked ? "Desmarcar" : "Marcar"} ${escapeHtml(name)}"
            >
              <span class="shopping-check__box${checked ? " is-on" : ""}" aria-hidden="true"></span>
            </button>
            <span class="shopping-row__qty">${item.quantity}x</span>
            <div class="shopping-row__stepper">
              <button type="button" class="icon-btn shopping-step" data-shopping-action="dec" data-id="${escapeHtml(item.ingredientId)}" aria-label="Diminuir">−</button>
              <button type="button" class="icon-btn shopping-step" data-shopping-action="inc" data-id="${escapeHtml(item.ingredientId)}" aria-label="Aumentar">+</button>
            </div>
            <img class="shopping-row__icon" src="${escapeHtml(image)}" alt="" />
            <div class="shopping-row__meta">
              <span class="shopping-row__name">${escapeHtml(name)}</span>
              ${amountText ? `<span class="shopping-row__amount">${escapeHtml(amountText)}</span>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function openPanel() {
    ensureShell();
    panelEl.hidden = false;
    document.querySelector("[data-shopping-toggle]")?.classList.add("is-active");
    document.querySelector("[data-shopping-toggle]")?.setAttribute("aria-expanded", "true");
    renderPanel();
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.hidden = true;
    document.querySelector("[data-shopping-toggle]")?.classList.remove("is-active");
    document.querySelector("[data-shopping-toggle]")?.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    ensureShell();
    if (panelEl.hidden) openPanel();
    else closePanel();
  }

  async function renderCatalogList() {
    const { ingredients } = await ensureData();
    const listRoot = catalogEl.querySelector("[data-catalog-list]");
    const query = (catalogEl.querySelector("[data-catalog-search]")?.value || "").trim().toLowerCase();
    const items = Object.values(ingredients)
      .filter((ing) => !query || String(ing.name || "").toLowerCase().includes(query))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt"));
    if (!items.length) {
      listRoot.innerHTML = `<p class="shopping-panel__empty">Nenhum ingrediente encontrado.</p>`;
      return;
    }
    listRoot.innerHTML = items
      .map(
        (ing) => `
        <button type="button" class="shopping-catalog-item" data-catalog-pick="${escapeHtml(ing.id)}">
          <img src="${escapeHtml(ing.image || "")}" alt="" />
          <span>${escapeHtml(ing.name || ing.id)}</span>
        </button>
      `
      )
      .join("");
  }

  async function openCatalogPicker() {
    ensureShell();
    catalogEl.hidden = false;
    const search = catalogEl.querySelector("[data-catalog-search]");
    if (search) search.value = "";
    await renderCatalogList();
    search?.focus();
  }

  function closeCatalogPicker() {
    if (!catalogEl) return;
    catalogEl.hidden = true;
  }

  function syncRecipeCheckAll() {
    const boxes = [...recipeEl.querySelectorAll('[data-recipe-list] input[type="checkbox"]')];
    const all = recipeEl.querySelector("[data-recipe-check-all]");
    if (!all || !boxes.length) return;
    all.checked = boxes.every((box) => box.checked);
    all.indeterminate = !all.checked && boxes.some((box) => box.checked);
  }

  async function openRecipePicker(recipe, ingredientsMap, measuresMap) {
    ensureShell();
    if (ingredientsMap) {
      ingredientsCache = { ...(ingredientsCache || {}), ...ingredientsMap };
    }
    if (measuresMap) {
      measuresCache = { ...(measuresCache || {}), ...measuresMap };
    }
    await ensureData();
    const listRoot = recipeEl.querySelector("[data-recipe-list]");
    const lines = (recipe?.groups || []).flatMap((g) => g.ingredients || []);
    if (!lines.length) {
      listRoot.innerHTML = `<p class="shopping-panel__empty">Esta receita não tem ingredientes.</p>`;
    } else {
      listRoot.innerHTML = lines
        .map((line, index) => {
          const ing = (ingredientsCache || {})[line.ingredientId];
          const measure = (measuresCache || {})[line.measureId];
          const qtyLabel = window.CookbookData.formatQuantity(line.quantity, measure);
          return `
            <label class="shopping-check shopping-recipe-line" data-recipe-line
              data-ingredient-id="${escapeHtml(line.ingredientId)}"
              data-measure-id="${escapeHtml(line.measureId || "")}"
              data-quantity="${escapeHtml(line.quantity ?? "")}"
              data-index="${index}"
            >
              <input type="checkbox" checked />
              <span class="shopping-check__box" aria-hidden="true"></span>
              <span class="shopping-recipe-line__qty">${escapeHtml(qtyLabel)}</span>
              <img src="${escapeHtml(ing?.image || "")}" alt="" />
              <span class="shopping-recipe-line__name">${escapeHtml(ing?.name || line.ingredientId)}</span>
            </label>
          `;
        })
        .join("");
    }
    const checkAll = recipeEl.querySelector("[data-recipe-check-all]");
    if (checkAll) {
      checkAll.checked = lines.length > 0;
      checkAll.indeterminate = false;
    }
    recipeEl.hidden = false;
  }

  function closeRecipePicker() {
    if (!recipeEl) return;
    recipeEl.hidden = true;
  }

  function bindHeaderToggle(root = document) {
    ensureShell();
    const btn = root.querySelector("[data-shopping-toggle]");
    if (!btn || btn.dataset.shoppingBound === "1") return;
    btn.dataset.shoppingBound = "1";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePanel();
    });
  }

  window.CookbookShopping = {
    loadList,
    addRecipeLines,
    addManual,
    setChecked,
    adjustQuantity,
    clearList,
    openPanel,
    closePanel,
    togglePanel,
    openRecipePicker,
    bindHeaderToggle,
    renderPanel,
  };
})();
