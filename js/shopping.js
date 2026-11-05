(function () {
  let measuresCache = null;
  let ingredientsCache = null;
  let catalogEl = null;
  let recipeEl = null;
  let createModal = null;
  let createImagePicker = null;
  let createImageFile = null;
  let chromeBound = false;
  let listActionsBound = false;

  const CHECK_MARK_SVG = () =>
    window.CookbookIcons.check({
      size: 36,
      fill: window.CookbookIcons.leaf,
      className: "shopping-check__mark",
    });

  function refreshShoppingCheckIcon(input) {
    const icon = input?.parentElement?.querySelector(".shopping-check__icon");
    if (!icon || !input) return;
    icon.outerHTML = window.CookbookIcons.checkboxIcon(input.checked);
  }

  function syncRecipeCheckIcons() {
    if (!recipeEl) return;
    recipeEl.querySelectorAll(".shopping-check input[type='checkbox']").forEach(refreshShoppingCheckIcon);
  }

  function storageKey() {
    return window.CookbookConfig.storageKeys.shoppingList;
  }

  function escapeHtml(value) {
    return (window.CookbookUI?.escapeHtml || ((v) => String(v ?? "")))(value);
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
    // Always reload so manage/edit image path changes (e.g. .png → .svg) show up.
    const [measures, ingredients] = await Promise.all([
      window.CookbookData.loadMeasures(),
      window.CookbookData.loadIngredientIndex(),
    ]);
    measuresCache = Object.fromEntries((measures || []).map((m) => [m.id, m]));
    ingredientsCache = Object.fromEntries((ingredients || []).map((i) => [i.id, i]));
    return { measures: measuresCache, ingredients: ingredientsCache };
  }

  function formatAmounts(amounts, measures) {
    if (!amounts?.length) return "";
    return amounts
      .map((a) => window.CookbookData.formatQuantity(a.quantity, measures[a.measureId]))
      .filter(Boolean)
      .join(" + ");
  }

  function ensureModals() {
    if (catalogEl) return;

    catalogEl = document.createElement("div");
    catalogEl.className = "shopping-modal";
    catalogEl.hidden = true;
    catalogEl.innerHTML = `
      <div class="shopping-modal__backdrop" data-catalog-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-label="Adicionar ingrediente" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title">Adicionar ingrediente</h2>
          <button type="button" class="icon-btn" data-catalog-close aria-label="Fechar">
            ${window.CookbookIcons.closeSmall()}
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
      <div class="shopping-modal__panel" role="dialog" aria-label="Adicionar à lista" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title">Adicionar à lista</h2>
          <button type="button" class="icon-btn" data-recipe-close aria-label="Fechar">
            ${window.CookbookIcons.closeSmall()}
          </button>
        </div>
        <label class="shopping-check shopping-check--all">
          <input type="checkbox" data-recipe-check-all checked />
          ${window.CookbookIcons.checkboxIcon(true)}
          <span>Selecionar todos</span>
        </label>
        <div class="shopping-modal__list" data-recipe-list></div>
        <div class="shopping-modal__footer">
          <button type="button" class="btn btn--primary" data-recipe-confirm>Adicionar ao carrinho</button>
        </div>
      </div>
    `;
    document.body.appendChild(recipeEl);

    catalogEl.querySelectorAll("[data-catalog-close]").forEach((el) => {
      el.addEventListener("click", closeCatalogPicker);
    });
    catalogEl.querySelector("[data-catalog-search]")?.addEventListener("input", () => {
      renderCatalogList();
    });
    catalogEl.querySelector("[data-catalog-list]")?.addEventListener("click", (event) => {
      const createBtn = event.target.closest("[data-catalog-create]");
      if (createBtn) {
        closeCatalogPicker();
        openCreateModal();
        return;
      }
      const btn = event.target.closest("[data-catalog-pick]");
      if (!btn) return;
      addManual(btn.getAttribute("data-catalog-pick"));
      closeCatalogPicker();
      open();
      renderPage();
    });

    createModal = document.createElement("div");
    createModal.className = "shopping-modal";
    createModal.hidden = true;
    createModal.innerHTML = `
      <div class="shopping-modal__backdrop" data-create-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-labelledby="shopping-create-ingredient-title" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title" id="shopping-create-ingredient-title">Novo ingrediente</h2>
          <button type="button" class="icon-btn" data-create-close aria-label="Fechar">
            ${window.CookbookIcons.closeSmall()}
          </button>
        </div>
        <form class="editor-modal__body" data-create-form>
          <label class="field">
            <span>Nome</span>
            <input data-create-name required placeholder="Farinha de trigo" autocomplete="off" />
          </label>
          <div class="field">
            <span>Foto (opcional)</span>
            <div data-create-image></div>
          </div>
          <p class="status editor-modal__status" data-create-status hidden></p>
          <div class="editor-modal__footer">
            <button type="button" class="btn btn--ghost" data-create-close>Cancelar</button>
            <button type="submit" class="btn btn--primary">Salvar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(createModal);
    createModal.querySelectorAll("[data-create-close]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        closeCreateModal();
      });
    });
    createModal.querySelector("[data-create-form]").addEventListener("submit", saveNewIngredient);
    createImagePicker = window.CookbookUI.mountImagePicker(createModal.querySelector("[data-create-image]"), {
      onChange: (file) => {
        createImageFile = file;
      },
    });

    recipeEl.querySelectorAll("[data-recipe-close]").forEach((el) => {
      el.addEventListener("click", closeRecipePicker);
    });
    recipeEl.querySelector("[data-recipe-check-all]")?.addEventListener("change", (event) => {
      const on = event.target.checked;
      recipeEl.querySelectorAll('[data-recipe-list] input[type="checkbox"]').forEach((input) => {
        input.checked = on;
      });
      syncRecipeCheckIcons();
    });
    recipeEl.querySelector("[data-recipe-list]")?.addEventListener("change", (event) => {
      if (event.target?.matches?.('input[type="checkbox"]')) {
        refreshShoppingCheckIcon(event.target);
      }
      syncRecipeCheckAll();
    });
    recipeEl.querySelector("[data-recipe-confirm]")?.addEventListener("click", () => {
      const lines = [];
      recipeEl.querySelectorAll("[data-recipe-line]").forEach((row) => {
        const input = row.querySelector('input[type="checkbox"]');
        if (!input?.checked) return;
        const ingredientId = row.getAttribute("data-ingredient-id");
        if (!ingredientId) return;
        let amounts = [];
        try {
          amounts = JSON.parse(row.getAttribute("data-amounts") || "[]");
        } catch {
          amounts = [];
        }
        if (!Array.isArray(amounts) || !amounts.length) {
          lines.push({ ingredientId, measureId: "", quantity: "" });
          return;
        }
        amounts.forEach((amount) => {
          lines.push({
            ingredientId,
            measureId: amount.measureId || "",
            quantity: amount.quantity ?? "",
          });
        });
      });
      addRecipeLines(lines);
      closeRecipePicker();
      open();
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        if (createModal && !createModal.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeCreateModal();
        } else if (catalogEl && !catalogEl.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeCatalogPicker();
        } else if (recipeEl && !recipeEl.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeRecipePicker();
        }
      },
      true
    );
  }

  function closeCreateModal() {
    if (!createModal) return;
    window.CookbookUI.deactivateModalFocus?.(createModal);
    createModal.hidden = true;
    createImageFile = null;
    createImagePicker?.setUrl("");
    const form = createModal.querySelector("[data-create-form]");
    form?.reset();
    window.CookbookUI.showStatus(createModal.querySelector("[data-create-status]"), "", "info");
    const submit = form?.querySelector('[type="submit"]');
    if (submit) submit.disabled = false;
  }

  function openCreateModal() {
    ensureModals();
    if (!window.CookbookAuth?.isCook?.()) return;
    createModal.hidden = false;
    window.CookbookUI.activateModalFocus?.(createModal, "[data-create-name]");
  }

  async function saveNewIngredient(event) {
    event.preventDefault();
    const status = createModal.querySelector("[data-create-status]");
    const submit = createModal.querySelector('[type="submit"]');
    const name = createModal.querySelector("[data-create-name]").value.trim();
    const file = createImageFile || createImagePicker?.getFile() || null;
    if (!name) {
      window.CookbookUI.showStatus(status, "Informe o nome do ingrediente.", "error");
      return;
    }

    await ensureData();
    const catalog = Object.values(ingredientsCache || {});
    try {
      const ok = await window.CookbookUI.assertNameAvailable(catalog, name, {
        label: "um ingrediente",
      });
      if (!ok) return;
    } catch (err) {
      window.CookbookUI.showStatus(status, err.message || "Falha ao salvar ingrediente.", "error");
      return;
    }

    const existingIds = new Set(Object.keys(ingredientsCache || {}));
    const id = window.CookbookData.uniqueId(name, existingIds);
    let imagePath = "";

    submit.disabled = true;
    window.CookbookUI.showStatus(status, "Salvando ingrediente…", "info");

    try {
      if (file) {
        const ext = window.CookbookGitHub.extensionForFile(file);
        imagePath = `data/images/ingredients/${id}${ext}`;
        const base64 = await window.CookbookGitHub.fileToBase64(file);
        await window.CookbookSync.writeBase64(
          imagePath,
          base64,
          `Atualizar imagem do ingrediente: ${name}`
        );
      }

      const record = { id, name, image: imagePath };
      await window.CookbookSync.writeJson(
        `data/ingredients/${id}.json`,
        record,
        `Adicionar ingrediente: ${name}`
      );

      ingredientsCache[id] = record;
      await window.CookbookSync.writeJson(
        "data/ingredients/_index.json",
        window.CookbookData.sortByName(Object.values(ingredientsCache)),
        `Atualizar índice de ingredientes após ${name}`
      );

      closeCreateModal();
      addManual(id);
      open();
      renderPage();
    } catch (err) {
      window.CookbookUI.showStatus(status, err.message || "Falha ao salvar ingrediente.", "error");
      submit.disabled = false;
    }
  }

  function bindChrome() {
    if (chromeBound) return;
    const bar = document.querySelector("[data-shopping-bar]");
    if (!bar) return;
    chromeBound = true;
    bar.querySelector("[data-shopping-back]")?.addEventListener("click", () => {
      close();
    });
    bar.querySelector("[data-shopping-add]")?.addEventListener("click", () => {
      openCatalogPicker();
    });
    bar.querySelector("[data-shopping-clear]")?.addEventListener("click", () => {
      if (!window.confirm("Limpar toda a lista de compras?")) return;
      clearList();
      renderPage();
    });
  }

  function bindListActions() {
    if (listActionsBound) return;
    listActionsBound = true;
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-shopping-empty-add]")) {
        event.preventDefault();
        openCatalogPicker();
        return;
      }
      const btn = event.target.closest("[data-shopping-action]");
      if (!btn || !btn.closest(".shopping-page")) return;
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
      renderPage();
    });
  }

  function sortShoppingItems(list, ingredients) {
    return (list || []).slice().sort((a, b) => {
      const left = ingredients?.[a.ingredientId]?.name || a.ingredientId || "";
      const right = ingredients?.[b.ingredientId]?.name || b.ingredientId || "";
      return String(left).localeCompare(String(right), "pt", { sensitivity: "base" });
    });
  }

  async function buildPageUnits() {
    const { measures, ingredients } = await ensureData();
    const list = sortShoppingItems(loadList(), ingredients);
    const units = [`<h1 class="shopping-page__title">Lista de compras</h1>`];
    if (!list.length) {
      units.push(`<div class="shopping-page__empty-block">
        <p class="shopping-page__empty">Sua lista está vazia.</p>
        <button type="button" class="btn btn--primary" data-shopping-empty-add>Adicionar ingrediente</button>
      </div>`);
      return units;
    }
    list.forEach((item) => {
      units.push(rowHtml(item, ingredients, measures));
    });
    return units;
  }

  function rowHtml(item, ingredients, measures) {
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
          ${checked ? CHECK_MARK_SVG() : window.CookbookIcons.checkBoxOutlineBlank({ size: 28, className: "shopping-check__mark" })}
        </button>
        ${window.CookbookUI.thumbHtml(image, "shopping-row__icon")}
        <div class="shopping-row__meta">
          <span class="shopping-row__name">${escapeHtml(name)}</span>
          ${amountText ? `<span class="shopping-row__amount">${escapeHtml(amountText)}</span>` : ""}
        </div>
        <div class="shopping-row__stepper">
          <button type="button" class="icon-btn shopping-step" data-shopping-action="dec" data-id="${escapeHtml(item.ingredientId)}" aria-label="Diminuir">${window.CookbookIcons.remove()}</button>
          <span class="shopping-row__qty">${item.quantity}x</span>
          <button type="button" class="icon-btn shopping-step" data-shopping-action="inc" data-id="${escapeHtml(item.ingredientId)}" aria-label="Aumentar">${window.CookbookIcons.add()}</button>
        </div>
      </div>
    `;
  }

  async function renderPage() {
    ensureModals();
    bindChrome();
    bindListActions();
    if (document.body.classList.contains("is-shopping") && window.CookbookBook?.refreshShoppingContent) {
      await window.CookbookBook.refreshShoppingContent();
      return;
    }
    const listRoot = document.querySelector("[data-shopping-list]");
    if (!listRoot) return;
    const { measures, ingredients } = await ensureData();
    const list = sortShoppingItems(loadList(), ingredients);
    if (!list.length) {
      listRoot.innerHTML = `<div class="shopping-page__empty-block">
        <p class="shopping-page__empty">Sua lista está vazia.</p>
        <button type="button" class="btn btn--primary" data-shopping-empty-add>Adicionar ingrediente</button>
      </div>`;
      return;
    }
    listRoot.innerHTML = list.map((item) => rowHtml(item, ingredients, measures)).join("");
    void window.CookbookSync?.hydrateImages?.(listRoot);
  }

  function pageShellHtml() {
    return `
      <div class="shopping-page">
        <h1 class="shopping-page__title">Lista de compras</h1>
        <div class="shopping-page__list" data-shopping-list></div>
      </div>
    `;
  }

  function open() {
    ensureModals();
    bindChrome();
    if (window.CookbookBook?.openShopping) {
      window.CookbookBook.openShopping();
      return;
    }
    window.CookbookAuth.markOpenedEntry({ shopping: true });
    window.location.href = "index.html?shopping=1";
  }

  function close() {
    if (window.CookbookBook?.closeShopping) {
      window.CookbookBook.closeShopping();
      return;
    }
    window.CookbookAuth.markOpenedEntry();
    window.location.href = "index.html?home=1";
  }

  async function renderCatalogList() {
    const { ingredients } = await ensureData();
    const listRoot = catalogEl.querySelector("[data-catalog-list]");
    const query = (catalogEl.querySelector("[data-catalog-search]")?.value || "").trim().toLowerCase();
    const items = window.CookbookData.sortByName(
      Object.values(ingredients).filter(
        (ing) => !query || String(ing.name || "").toLowerCase().includes(query)
      )
    );
    const rows = items.length
      ? items
          .map(
            (ing) => `
        <button type="button" class="shopping-catalog-item" data-catalog-pick="${escapeHtml(ing.id)}">
          ${window.CookbookUI.thumbHtml(ing.image, "shopping-catalog-item__thumb")}
          <span>${escapeHtml(ing.name || ing.id)}</span>
        </button>
      `
          )
          .join("")
      : `<p class="shopping-page__empty">Nenhum ingrediente encontrado.</p>`;
    const createAction = window.CookbookAuth?.isCook?.()
      ? `
      <button type="button" class="shopping-catalog-item shopping-catalog-item--action" data-catalog-create>
        <span class="shopping-catalog-item__icon" aria-hidden="true">
          ${window.CookbookIcons.add()}
        </span>
        <span>Novo Ingrediente</span>
      </button>`
      : "";
    listRoot.innerHTML = `${rows}${createAction}`;
    void window.CookbookSync?.hydrateImages?.(listRoot);
  }

  async function openCatalogPicker() {
    ensureModals();
    catalogEl.hidden = false;
    const search = catalogEl.querySelector("[data-catalog-search]");
    if (search) search.value = "";
    await renderCatalogList();
    window.CookbookUI.activateModalFocus?.(catalogEl, "[data-catalog-search]");
  }

  function closeCatalogPicker() {
    if (!catalogEl) return;
    window.CookbookUI.deactivateModalFocus?.(catalogEl);
    catalogEl.hidden = true;
  }

  function syncRecipeCheckAll() {
    const boxes = [...recipeEl.querySelectorAll('[data-recipe-list] input[type="checkbox"]')];
    const all = recipeEl.querySelector("[data-recipe-check-all]");
    if (!all || !boxes.length) return;
    all.checked = boxes.every((box) => box.checked);
    all.indeterminate = !all.checked && boxes.some((box) => box.checked);
    refreshShoppingCheckIcon(all);
  }

  async function openRecipePicker(recipe, _ingredientsMap, _measuresMap) {
    ensureModals();
    await ensureData();
    const listRoot = recipeEl.querySelector("[data-recipe-list]");
    const lines = (recipe?.groups || []).flatMap((g) => g.ingredients || []);
    const merged = [];
    const byId = new Map();
    lines.forEach((line) => {
      if (!line?.ingredientId) return;
      let entry = byId.get(line.ingredientId);
      if (!entry) {
        entry = { ingredientId: line.ingredientId, amounts: [] };
        byId.set(line.ingredientId, entry);
        merged.push(entry);
      }
      mergeAmountInto(entry.amounts, {
        quantity: line.quantity,
        measureId: line.measureId,
      });
    });
    if (!merged.length) {
      listRoot.innerHTML = `<p class="shopping-page__empty">Esta receita não tem ingredientes.</p>`;
    } else {
      const sorted = sortShoppingItems(merged, ingredientsCache || {});
      listRoot.innerHTML = sorted
        .map((entry) => {
          const ing = (ingredientsCache || {})[entry.ingredientId];
          const qtyLabel = formatAmounts(entry.amounts, measuresCache || {});
          const amountsJson = escapeHtml(JSON.stringify(entry.amounts));
          return `
            <label class="shopping-check shopping-recipe-line" data-recipe-line
              data-ingredient-id="${escapeHtml(entry.ingredientId)}"
              data-amounts="${amountsJson}"
            >
              <input type="checkbox" checked />
              ${window.CookbookIcons.checkboxIcon(true)}
              ${window.CookbookUI.thumbHtml(ing?.image, "shopping-recipe-line__thumb")}
              <span class="shopping-recipe-line__name">${escapeHtml(ing?.name || entry.ingredientId)}</span>
              <span class="shopping-recipe-line__qty">${escapeHtml(qtyLabel)}</span>
            </label>
          `;
        })
        .join("");
      await window.CookbookSync?.hydrateImages?.(listRoot);
    }
    const checkAll = recipeEl.querySelector("[data-recipe-check-all]");
    if (checkAll) {
      checkAll.checked = merged.length > 0;
      checkAll.indeterminate = false;
      refreshShoppingCheckIcon(checkAll);
    }
    recipeEl.hidden = false;
    window.CookbookUI.activateModalFocus?.(recipeEl, "[data-recipe-confirm]");
  }

  function closeRecipePicker() {
    if (!recipeEl) return;
    window.CookbookUI.deactivateModalFocus?.(recipeEl);
    recipeEl.hidden = true;
  }

  function hasOpenModal() {
    return Boolean(
      (catalogEl && !catalogEl.hidden) ||
        (recipeEl && !recipeEl.hidden) ||
        (createModal && !createModal.hidden)
    );
  }

  function bindHeaderToggle(root = document) {
    const btn = root.querySelector("[data-shopping-toggle]");
    if (!btn || btn.dataset.shoppingBound === "1") return;
    btn.dataset.shoppingBound = "1";
    btn.removeAttribute("aria-haspopup");
    btn.removeAttribute("aria-expanded");
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      open();
    });
  }

  window.CookbookShopping = {
    loadList,
    addRecipeLines,
    addManual,
    setChecked,
    adjustQuantity,
    clearList,
    open,
    close,
    openPanel: open,
    closePanel: close,
    togglePanel: open,
    openRecipePicker,
    bindHeaderToggle,
    renderPage,
    pageShellHtml,
    buildPageUnits,
    ensureModals,
    bindChrome,
    bindListActions,
    hasOpenModal,
  };
})();
