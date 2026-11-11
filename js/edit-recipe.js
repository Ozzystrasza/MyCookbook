(function () {
  const { qs, showStatus, mountImagePicker, assertNameAvailable } = window.CookbookUI;
  const params = new URLSearchParams(window.location.search);
  let editingId = params.get("id");
  let duplicateFromId = params.get("from");
  let inBookMode = false;
  let onCloseCb = null;
  let leaveGuardBound = false;

  let categories = [];
  let measures = [];
  let ingredients = [];
  let recipeIndex = [];
  let savedImagePath = "";
  let imageFile = null;
  let imageCleared = false;
  let dirty = false;
  let allowLeave = false;
  let pendingLeaveHref = "";
  let pickerTargetInput = null;
  let pickKind = "ingredient";
  let createTargetInput = null;
  let selectedCategoryIds = [];
  let recipeImagePicker = null;
  let createImagePicker = null;
  let createImageFile = null;

  let leaveModal = null;
  let pickModal = null;
  let createCategoryModal = null;
  let createMeasureModal = null;
  let createIngredientModal = null;

  const PICK_META = {
    ingredient: {
      title: "Ingrediente",
      searchLabel: "Buscar ingrediente",
      createLabel: "Novo Ingrediente",
    },
    category: {
      title: "Categoria",
      searchLabel: "Buscar categoria",
      createLabel: "Nova categoria",
    },
    measure: {
      title: "Medida",
      searchLabel: "Buscar medida",
      createLabel: "Nova medida",
    },
  };

  function formShellHtml() {
    return `
      <div class="book-form panel panel--in-book">
        <h1 id="page-title">Nova receita</h1>
        <p class="status" data-status hidden></p>
        <form id="recipe-form" class="stack">
          <div class="row row--2">
            <label class="field">
              <span>Título</span>
              <input id="title" name="title" required />
            </label>
            <div class="field">
              <span>Categorias</span>
              <div class="category-tags" data-category-tags>
                <div class="category-tags__list" data-category-chips></div>
                <button type="button" class="ingredient-picker__trigger category-tags__add" data-category-trigger aria-haspopup="dialog">
                  <span class="ingredient-picker__value">Adicionar…</span>
                  ${chevronIcon()}
                </button>
              </div>
            </div>
          </div>
          <div class="field">
            <span>Imagem da receita</span>
            <div data-recipe-image></div>
          </div>
          <div class="toolbar toolbar--compact">
            <h2 class="toolbar__label">Grupos</h2>
            <button type="button" class="icon-btn" data-add-group aria-label="Adicionar grupo" title="Adicionar grupo">
              ${plusIcon()}
            </button>
          </div>
          <div class="stack" data-groups-editor></div>
        </form>
      </div>
    `;
  }

  function requestClose() {
    if (typeof onCloseCb === "function") {
      onCloseCb();
      return;
    }
    window.CookbookAuth.markOpenedEntry();
    window.location.href = "index.html?home=1";
  }

  function blankGroup() {
    return {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "",
      ingredients: [],
      steps: [{ description: "" }],
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function markDirty() {
    dirty = true;
  }

  function clearDirty() {
    dirty = false;
  }

  function plusIcon() {
    return window.CookbookIcons.add();
  }

  function minusIcon() {
    return window.CookbookIcons.remove();
  }

  function chevronIcon() {
    return window.CookbookIcons.keyboardArrowDown({ size: 16, className: "ingredient-picker__chevron" });
  }

  function closeIcon() {
    return window.CookbookIcons.closeSmall();
  }

  function kindFromInput(input) {
    const field = input?.dataset?.field || input?.id || "";
    if (field === "measureId") return "measure";
    return "ingredient";
  }

  function renderCategoryChips() {
    const list = qs("[data-category-chips]");
    if (!list) return;
    list.innerHTML = selectedCategoryIds
      .map((id) => {
        const label = catalogLabel("category", id) || id;
        return `
          <span class="category-tag">
            <span class="category-tag__label">${escapeHtml(label)}</span>
            <button type="button" class="category-tag__remove" data-remove-category="${escapeHtml(id)}" aria-label="Remover ${escapeHtml(label)}">
              ${closeIcon()}
            </button>
          </span>`;
      })
      .join("");
  }

  function setSelectedCategoryIds(ids) {
    const seen = new Set();
    selectedCategoryIds = [];
    for (const id of ids || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      selectedCategoryIds.push(id);
    }
    renderCategoryChips();
  }

  function addCategoryId(id) {
    if (!id || selectedCategoryIds.includes(id)) {
      renderCategoryChips();
      return;
    }
    selectedCategoryIds = [...selectedCategoryIds, id];
    renderCategoryChips();
  }

  function removeCategoryId(id) {
    selectedCategoryIds = selectedCategoryIds.filter((entry) => entry !== id);
    renderCategoryChips();
  }

  function catalogItems(kind) {
    if (kind === "category") return categories;
    if (kind === "measure") return measures;
    return ingredients;
  }

  function catalogLabel(kind, id) {
    if (!id) return "";
    const item = catalogItems(kind).find((entry) => entry.id === id);
    if (!item) return id;
    if (kind === "measure") return item.abbrev || item.name || id;
    return item.name || id;
  }

  function setPickerValue(input, id) {
    if (!input) return;
    input.value = id || "";
    const kind = kindFromInput(input);
    const wrap = input.closest(".catalog-picker");
    const trigger =
      wrap?.querySelector("[data-picker-trigger]") ||
      wrap?.querySelector("[data-ingredient-trigger], [data-measure-trigger]");
    const valueEl = trigger?.querySelector(".ingredient-picker__value");
    if (!valueEl) return;
    const label = catalogLabel(kind, id);
    if (label) {
      valueEl.textContent = label;
      valueEl.classList.remove("is-placeholder");
    } else {
      valueEl.textContent = "Selecione…";
      valueEl.classList.add("is-placeholder");
    }
  }

  function refreshAllPickers() {
    renderCategoryChips();
    qs("[data-groups-editor]")
      ?.querySelectorAll('[data-field="ingredientId"], [data-field="measureId"]')
      .forEach((input) => setPickerValue(input, input.value));
  }

  function ensureModals() {
    if (leaveModal) return;

    leaveModal = document.createElement("div");
    leaveModal.className = "shopping-modal";
    leaveModal.hidden = true;
    leaveModal.innerHTML = `
      <div class="shopping-modal__backdrop" data-leave-stay tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-labelledby="leave-title" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title" id="leave-title">Descartar receita?</h2>
          <button type="button" class="icon-btn" data-leave-stay aria-label="Fechar">${closeIcon()}</button>
        </div>
        <p class="hint">Há alterações não salvas. Se sair agora, a receita será perdida.</p>
        <div class="editor-modal__footer">
          <button type="button" class="btn btn--ghost" data-leave-stay>Ficar na página</button>
          <button type="button" class="btn btn--danger" data-leave-discard>Descartar</button>
        </div>
      </div>
    `;
    document.body.appendChild(leaveModal);
    leaveModal.querySelectorAll("[data-leave-stay]").forEach((el) => {
      el.addEventListener("click", closeLeaveModal);
    });
    leaveModal.querySelector("[data-leave-discard]").addEventListener("click", () => {
      allowLeave = true;
      clearDirty();
      const href = pendingLeaveHref || "";
      pendingLeaveHref = "";
      closeLeaveModal();
      if (inBookMode && (!href || href === "__close__")) {
        requestClose();
        return;
      }
      window.CookbookAuth.markOpenedEntry({
        shopping: /[?&]shopping=1(?:&|$)/.test(href),
      });
      window.location.href = href || "index.html?home=1";
    });

    pickModal = document.createElement("div");
    pickModal.className = "shopping-modal";
    pickModal.hidden = true;
    pickModal.innerHTML = `
      <div class="shopping-modal__backdrop" data-pick-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-label="Escolher item" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title" data-pick-title>Ingrediente</h2>
          <button type="button" class="icon-btn" data-pick-close aria-label="Fechar">${closeIcon()}</button>
        </div>
        <label class="shopping-modal__search">
          <span class="visually-hidden" data-pick-search-label>Buscar</span>
          <input type="search" data-pick-search placeholder="Buscar…" autocomplete="off" />
        </label>
        <div class="shopping-modal__list" data-pick-list></div>
      </div>
    `;
    document.body.appendChild(pickModal);
    pickModal.querySelectorAll("[data-pick-close]").forEach((el) => {
      el.addEventListener("click", closePickModal);
    });
    pickModal.querySelector("[data-pick-search]").addEventListener("input", renderPickList);
    pickModal.querySelector("[data-pick-list]").addEventListener("click", (event) => {
      const createBtn = event.target.closest("[data-pick-create]");
      if (createBtn) {
        const target = pickerTargetInput;
        const kind = pickKind;
        closePickModal();
        openCreateModal(target, kind);
        return;
      }
      const pickBtn = event.target.closest("[data-pick-id]");
      if (!pickBtn) return;
      const pickedId = pickBtn.getAttribute("data-pick-id");
      if (pickKind === "category") {
        addCategoryId(pickedId);
        markDirty();
        closePickModal();
        return;
      }
      if (!pickerTargetInput) return;
      setPickerValue(pickerTargetInput, pickedId);
      markDirty();
      closePickModal();
    });

    createCategoryModal = buildCreateModal({
      titleId: "create-category-title",
      title: "Nova categoria",
      body: `
          <label class="field">
            <span>Nome</span>
            <input data-create-name required placeholder="Sobremesas" autocomplete="off" />
          </label>`,
      onSubmit: saveNewCategory,
    });

    createMeasureModal = buildCreateModal({
      titleId: "create-measure-title",
      title: "Nova medida",
      body: `
          <label class="field">
            <span>Nome</span>
            <input data-create-name required placeholder="colher de sopa" autocomplete="off" />
          </label>
          <label class="field">
            <span>Abreviação</span>
            <input data-create-abbrev placeholder="c.s." autocomplete="off" />
          </label>`,
      onSubmit: saveNewMeasure,
    });

    createIngredientModal = buildCreateModal({
      titleId: "create-ingredient-title",
      title: "Novo ingrediente",
      body: `
          <label class="field">
            <span>Nome</span>
            <input data-create-name required placeholder="Farinha de trigo" autocomplete="off" />
          </label>
          <div class="field">
            <span>Foto (opcional)</span>
            <div data-create-image></div>
          </div>`,
      onSubmit: saveNewIngredient,
    });
    createImagePicker = mountImagePicker(createIngredientModal.querySelector("[data-create-image]"), {
      onChange: (file) => {
        createImageFile = file;
      },
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!leaveModal.hidden) {
        closeLeaveModal();
        return;
      }
      if (activeCreateModal()) {
        closeCreateModals();
        return;
      }
      if (!pickModal.hidden) closePickModal();
    });
  }

  function buildCreateModal({ titleId, title, body, onSubmit }) {
    const modal = document.createElement("div");
    modal.className = "shopping-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="shopping-modal__backdrop" data-create-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-labelledby="${titleId}" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title" id="${titleId}">${title}</h2>
          <button type="button" class="icon-btn" data-create-close aria-label="Fechar">${closeIcon()}</button>
        </div>
        <form class="editor-modal__body" data-create-form>
          ${body}
          <p class="status editor-modal__status" data-create-status hidden></p>
          <div class="editor-modal__footer">
            <button type="button" class="btn btn--ghost" data-create-close>Cancelar</button>
            <button type="submit" class="btn btn--primary">Salvar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-create-close]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();
        closeCreateModals();
      });
    });
    modal.querySelector("[data-create-form]").addEventListener("submit", onSubmit);
    return modal;
  }

  function activeCreateModal() {
    if (createCategoryModal && !createCategoryModal.hidden) return createCategoryModal;
    if (createMeasureModal && !createMeasureModal.hidden) return createMeasureModal;
    if (createIngredientModal && !createIngredientModal.hidden) return createIngredientModal;
    return null;
  }

  function closeLeaveModal() {
    window.CookbookUI.deactivateModalFocus?.(leaveModal);
    leaveModal.hidden = true;
    pendingLeaveHref = "";
  }

  function openLeaveModal(href) {
    ensureModals();
    pendingLeaveHref = href;
    leaveModal.hidden = false;
    window.CookbookUI.activateModalFocus?.(leaveModal, "[data-leave-stay]");
  }

  function closePickModal() {
    window.CookbookUI.deactivateModalFocus?.(pickModal);
    pickModal.hidden = true;
    pickerTargetInput = null;
    pickKind = "ingredient";
    const search = pickModal.querySelector("[data-pick-search]");
    if (search) search.value = "";
  }

  function openPickModal(input, kind) {
    ensureModals();
    pickerTargetInput = input;
    pickKind = kind || kindFromInput(input);
    const meta = PICK_META[pickKind] || PICK_META.ingredient;
    const titleEl = pickModal.querySelector("[data-pick-title]");
    const searchLabel = pickModal.querySelector("[data-pick-search-label]");
    if (titleEl) titleEl.textContent = meta.title;
    if (searchLabel) searchLabel.textContent = meta.searchLabel;
    pickModal.querySelector(".shopping-modal__panel")?.setAttribute("aria-label", `Escolher ${meta.title.toLowerCase()}`);
    pickModal.hidden = false;
    renderPickList();
    window.CookbookUI.activateModalFocus?.(pickModal, "[data-pick-search]");
  }

  function resetCreateModal(modal) {
    if (!modal) return;
    window.CookbookUI.deactivateModalFocus?.(modal);
    modal.hidden = true;
    const form = modal.querySelector("[data-create-form]");
    form?.reset();
    showStatus(modal.querySelector("[data-create-status]"), "", "info");
    const submit = form?.querySelector('[type="submit"]');
    if (submit) submit.disabled = false;
  }

  function closeCreateModals() {
    createTargetInput = null;
    createImageFile = null;
    createImagePicker?.setUrl("");
    resetCreateModal(createCategoryModal);
    resetCreateModal(createMeasureModal);
    resetCreateModal(createIngredientModal);
  }

  function openCreateModal(input, kind) {
    ensureModals();
    createTargetInput = input;
    const resolved = kind || kindFromInput(input);
    const modal =
      resolved === "category"
        ? createCategoryModal
        : resolved === "measure"
          ? createMeasureModal
          : createIngredientModal;
    modal.hidden = false;
    window.CookbookUI.activateModalFocus?.(modal, "[data-create-name]");
  }

  function finishCreate(id, kind = null) {
    const target = createTargetInput;
    const resolved = kind || (target ? kindFromInput(target) : null);
    closeCreateModals();
    refreshAllPickers();
    if (resolved === "category") {
      addCategoryId(id);
      markDirty();
    } else if (target) {
      setPickerValue(target, id);
      markDirty();
    }
    window.CookbookUI?.nudgeSync?.();
  }

  function measurePickLabel(item) {
    const name = item.name || item.id || "";
    const abbrev = item.abbrev || "";
    if (abbrev && abbrev !== name) return `${name} - ${abbrev}`;
    return name;
  }

  function renderPickList() {
    const list = pickModal.querySelector("[data-pick-list]");
    const query = (pickModal.querySelector("[data-pick-search]")?.value || "").trim().toLowerCase();
    const meta = PICK_META[pickKind] || PICK_META.ingredient;
    const items = catalogItems(pickKind);
    const selected = pickKind === "category" ? new Set(selectedCategoryIds) : null;
    const filtered = items
      .filter((item) => {
        if (selected?.has(item.id)) return false;
        if (!query) return true;
        const name = String(item.name || "").toLowerCase();
        const abbrev = String(item.abbrev || "").toLowerCase();
        return name.includes(query) || abbrev.includes(query);
      })
      .slice()
      .sort(window.CookbookData.compareByName);
    const rows = filtered
      .map((item) => {
        if (pickKind === "ingredient") {
          return `
        <button type="button" class="shopping-catalog-item" data-pick-id="${escapeHtml(item.id)}">
          ${window.CookbookUI.thumbHtml(item.image, "shopping-catalog-item__thumb")}
          <span>${escapeHtml(item.name || item.id)}</span>
        </button>`;
        }
        const label = pickKind === "measure" ? measurePickLabel(item) : item.name || item.id;
        return `
        <button type="button" class="shopping-catalog-item shopping-catalog-item--text" data-pick-id="${escapeHtml(item.id)}">
          <span>${escapeHtml(label)}</span>
        </button>`;
      })
      .join("");
    list.innerHTML = `
      ${rows}
      <button type="button" class="shopping-catalog-item shopping-catalog-item--action" data-pick-create>
        <span class="shopping-catalog-item__icon" aria-hidden="true">
          ${plusIcon()}
        </span>
        <span>${escapeHtml(meta.createLabel)}</span>
      </button>
    `;
    void window.CookbookSync.hydrateImages(list);
  }

  async function saveNewCategory(event) {
    event.preventDefault();
    const modal = createCategoryModal;
    const status = modal.querySelector("[data-create-status]");
    const submit = modal.querySelector('[type="submit"]');
    const name = modal.querySelector("[data-create-name]").value.trim();
    if (!name) {
      showStatus(status, "Informe o nome da categoria.", "error");
      return;
    }

    try {
      const ok = await assertNameAvailable(categories, name, { label: "uma categoria" });
      if (!ok) return;
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      return;
    }

    const id = window.CookbookData.uniqueId(name, new Set(categories.map((c) => c.id)));
    submit.disabled = true;
    showStatus(status, "Salvando…", "info");
    try {
      categories = window.CookbookData.sortByName([...categories, { id, name }]);
      await window.CookbookSync.writeJson(
        "data/categories.json",
        categories,
        `Adicionar categoria: ${name}`
      );
      finishCreate(id, "category");
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      submit.disabled = false;
    }
  }

  async function saveNewMeasure(event) {
    event.preventDefault();
    const modal = createMeasureModal;
    const status = modal.querySelector("[data-create-status]");
    const submit = modal.querySelector('[type="submit"]');
    const name = modal.querySelector("[data-create-name]").value.trim();
    const abbrev = modal.querySelector("[data-create-abbrev]")?.value.trim() || name;
    if (!name) {
      showStatus(status, "Informe o nome da medida.", "error");
      return;
    }

    try {
      const ok = await assertNameAvailable(measures, name, { label: "uma medida" });
      if (!ok) return;
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      return;
    }

    const id = window.CookbookData.uniqueId(name, new Set(measures.map((m) => m.id)));
    submit.disabled = true;
    showStatus(status, "Salvando…", "info");
    try {
      measures = window.CookbookData.sortByName([...measures, { id, name, abbrev }]);
      await window.CookbookSync.writeJson(
        "data/measures.json",
        measures,
        `Adicionar medida: ${name}`
      );
      finishCreate(id);
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      submit.disabled = false;
    }
  }

  async function saveNewIngredient(event) {
    event.preventDefault();
    const modal = createIngredientModal;
    const status = modal.querySelector("[data-create-status]");
    const submit = modal.querySelector('[type="submit"]');
    const name = modal.querySelector("[data-create-name]").value.trim();
    const file = createImageFile || createImagePicker?.getFile() || null;
    if (!name) {
      showStatus(status, "Informe o nome do ingrediente.", "error");
      return;
    }

    try {
      const ok = await assertNameAvailable(ingredients, name, { label: "um ingrediente" });
      if (!ok) return;
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      return;
    }

    const id = window.CookbookData.uniqueId(name, new Set(ingredients.map((i) => i.id)));
    submit.disabled = true;
    showStatus(status, "Salvando…", "info");
    try {
      let imagePath = "";
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
      ingredients = window.CookbookData.sortByName([...ingredients, record]);
      await window.CookbookSync.writeJson(
        "data/ingredients/_index.json",
        ingredients,
        `Atualizar índice de ingredientes após ${name}`
      );
      finishCreate(id);
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      submit.disabled = false;
    }
  }

  function focusNewControl(el) {
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function renderGroups(groups, { focus } = {}) {
    const host = qs("[data-groups-editor]");
    host.innerHTML = "";
    groups.forEach((group, groupIndex) => {
      const wrap = document.createElement("div");
      wrap.className = "group-editor";
      wrap.dataset.groupIndex = String(groupIndex);
      wrap.innerHTML = `
        <div class="group-editor__header">
          <span class="field-label">Nome do grupo</span>
          <div class="actions actions--row">
            <button type="button" class="icon-btn" data-remove-group aria-label="Remover grupo" title="Remover grupo">${minusIcon()}</button>
          </div>
          <input class="field-control" data-field="name" value="${escapeHtml(group.name || "")}" placeholder="Massa, Cobertura…" />
        </div>
        <div>
          <div class="toolbar toolbar--compact">
            <strong class="toolbar__label">Ingredientes</strong>
            <button type="button" class="icon-btn" data-add-ingredient aria-label="Adicionar ingrediente" title="Adicionar ingrediente">${plusIcon()}</button>
          </div>
          <div data-ingredient-lines></div>
        </div>
        <div>
          <div class="toolbar toolbar--compact">
            <strong class="toolbar__label">Passos</strong>
            <button type="button" class="icon-btn" data-add-step aria-label="Adicionar passo" title="Adicionar passo">${plusIcon()}</button>
          </div>
          <div data-step-lines></div>
        </div>
      `;

      const ingredientHost = wrap.querySelector("[data-ingredient-lines]");
      (group.ingredients || []).forEach((line, lineIndex) => {
        const row = document.createElement("div");
        row.className = "line-row ingredients";
        const selectedLabel = catalogLabel("ingredient", line.ingredientId);
        const measureLabel = catalogLabel("measure", line.measureId);
        row.innerHTML = `
          <span class="field-label line-row__ilabel">Ingrediente</span>
          <div class="actions actions--row">
            <button type="button" class="icon-btn" data-remove-ingredient aria-label="Remover ingrediente" title="Remover">${minusIcon()}</button>
          </div>
          <div class="catalog-picker line-row__ipicker">
            <input type="hidden" data-field="ingredientId" value="${escapeHtml(line.ingredientId || "")}" />
            <button type="button" class="ingredient-picker__trigger" data-ingredient-trigger data-picker-trigger aria-haspopup="dialog">
              <span class="ingredient-picker__value ${selectedLabel ? "" : "is-placeholder"}">${escapeHtml(selectedLabel || "Selecione…")}</span>
              ${chevronIcon()}
            </button>
          </div>
          <span class="field-label line-row__mlabel">Medida</span>
          <div class="catalog-picker line-row__mctrl">
            <input type="hidden" data-field="measureId" value="${escapeHtml(line.measureId || "")}" />
            <button type="button" class="ingredient-picker__trigger" data-measure-trigger data-picker-trigger aria-haspopup="dialog">
              <span class="ingredient-picker__value ${measureLabel ? "" : "is-placeholder"}">${escapeHtml(measureLabel || "Selecione…")}</span>
              ${chevronIcon()}
            </button>
          </div>
          <span class="field-label line-row__qlabel">Quantidade</span>
          <input class="field-control line-row__qctrl" data-field="quantity" value="${escapeHtml(line.quantity ?? "")}" placeholder="2 ou 1/2" />
        `;
        row.querySelector("[data-ingredient-trigger]").addEventListener("click", () => {
          openPickModal(row.querySelector('[data-field="ingredientId"]'), "ingredient");
        });
        row.querySelector("[data-measure-trigger]").addEventListener("click", () => {
          openPickModal(row.querySelector('[data-field="measureId"]'), "measure");
        });
        row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
          const current = readGroupsFromDom({ keepEmpty: true });
          current[groupIndex].ingredients.splice(lineIndex, 1);
          markDirty();
          renderGroups(current);
        });
        ingredientHost.append(row);
      });

      const stepHost = wrap.querySelector("[data-step-lines]");
      const stepLines = group.steps?.length ? group.steps : [{ description: "" }];
      stepLines.forEach((step, stepIndex) => {
        const row = document.createElement("div");
        row.className = "line-row steps";
        const atStart = stepIndex === 0;
        const atEnd = stepIndex === stepLines.length - 1;
        row.innerHTML = `
          <span class="field-label line-row__slabel">Passo ${stepIndex + 1}</span>
          <div class="actions actions--row">
            <button type="button" class="icon-btn" data-move-step-up aria-label="Mover para cima" title="Mover para cima" ${atStart ? "disabled" : ""}>${window.CookbookIcons.keyboardArrowUp()}</button>
            <button type="button" class="icon-btn" data-move-step-down aria-label="Mover para baixo" title="Mover para baixo" ${atEnd ? "disabled" : ""}>${window.CookbookIcons.keyboardArrowDown()}</button>
            <button type="button" class="icon-btn" data-remove-step aria-label="Remover passo" title="Remover">${minusIcon()}</button>
          </div>
          <textarea class="field-control line-row__sctrl" data-field="description" placeholder="O que fazer…">${escapeHtml(step.description || "")}</textarea>
        `;
        const moveStep = (delta) => {
          const current = readGroupsFromDom({ keepEmpty: true });
          const steps = current[groupIndex].steps;
          const next = stepIndex + delta;
          if (next < 0 || next >= steps.length) return;
          [steps[stepIndex], steps[next]] = [steps[next], steps[stepIndex]];
          markDirty();
          renderGroups(current);
        };
        row.querySelector("[data-move-step-up]").addEventListener("click", () => moveStep(-1));
        row.querySelector("[data-move-step-down]").addEventListener("click", () => moveStep(1));
        row.querySelector("[data-remove-step]").addEventListener("click", () => {
          const current = readGroupsFromDom({ keepEmpty: true });
          current[groupIndex].steps.splice(stepIndex, 1);
          if (!current[groupIndex].steps.length) {
            current[groupIndex].steps.push({ description: "" });
          }
          markDirty();
          renderGroups(current);
        });
        stepHost.append(row);
      });

      wrap.querySelector("[data-add-ingredient]").addEventListener("click", () => {
        const current = readGroupsFromDom({ keepEmpty: true });
        current[groupIndex].ingredients.push({ ingredientId: "", measureId: "", quantity: "" });
        markDirty();
        renderGroups(current, { focus: { type: "ingredient", groupIndex } });
      });
      wrap.querySelector("[data-add-step]").addEventListener("click", () => {
        const current = readGroupsFromDom({ keepEmpty: true });
        current[groupIndex].steps.push({ description: "" });
        markDirty();
        renderGroups(current, { focus: { type: "step", groupIndex } });
      });
      wrap.querySelector("[data-remove-group]").addEventListener("click", () => {
        const current = readGroupsFromDom({ keepEmpty: true });
        current.splice(groupIndex, 1);
        markDirty();
        renderGroups(current.length ? current : [blankGroup()]);
      });

      host.append(wrap);
    });

    if (!focus) return;
    const groupEl =
      focus.type === "group"
        ? host.lastElementChild
        : host.querySelector(`[data-group-index="${focus.groupIndex}"]`);
    if (!groupEl) return;
    if (focus.type === "group") {
      focusNewControl(groupEl.querySelector('[data-field="name"]'));
    } else if (focus.type === "ingredient") {
      const rows = groupEl.querySelectorAll("[data-ingredient-lines] .line-row");
      focusNewControl(rows[rows.length - 1]?.querySelector("[data-ingredient-trigger]"));
    } else if (focus.type === "step") {
      const rows = groupEl.querySelectorAll("[data-step-lines] .line-row");
      focusNewControl(rows[rows.length - 1]?.querySelector('[data-field="description"]'));
    }
  }

  function readGroupsFromDom({ keepEmpty = false } = {}) {
    const usedIds = new Set();
    return [...qs("[data-groups-editor]").children].map((wrap, index) => {
      const name = wrap.querySelector('[data-field="name"]').value.trim();
      const idBase = name || `group-${index + 1}`;
      let id = window.CookbookData.slugify(idBase);
      if (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      const ingredientsLines = [...wrap.querySelectorAll("[data-ingredient-lines] .line-row")].map((row) => ({
        ingredientId: row.querySelector('[data-field="ingredientId"]').value,
        measureId: row.querySelector('[data-field="measureId"]').value,
        quantity: row.querySelector('[data-field="quantity"]').value.trim(),
      }));
      const steps = [...wrap.querySelectorAll("[data-step-lines] .line-row")].map((row) => ({
        description: row.querySelector('[data-field="description"]').value.trim(),
      }));
      return {
        id,
        name,
        ingredients: keepEmpty ? ingredientsLines : ingredientsLines.filter((l) => l.ingredientId),
        steps: keepEmpty ? steps : steps.filter((s) => s.description),
      };
    });
  }

  async function fillForm(recipe) {
    qs("#title").value = recipe.title || "";
    setSelectedCategoryIds(window.CookbookData.recipeCategoryIds(recipe));
    savedImagePath = recipe.image || "";
    imageFile = null;
    imageCleared = false;
    const preview = savedImagePath
      ? await window.CookbookSync.objectUrl(savedImagePath)
      : "";
    recipeImagePicker?.setUrl(preview);
    renderGroups(recipe.groups?.length ? recipe.groups : [blankGroup()]);
    clearDirty();
  }

  function extensionFromPath(path) {
    const match = String(path || "").match(/\.[a-z0-9]+$/i);
    return match ? match[0].toLowerCase() : ".jpg";
  }

  async function copyRecipeImage(sourcePath, destPath, message) {
    const url = await window.CookbookSync.objectUrl(sourcePath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Não foi possível copiar a imagem.`);
    const blob = await res.blob();
    const file = new File([blob], destPath.split("/").pop() || "image", {
      type: blob.type || "image/jpeg",
    });
    const base64 = await window.CookbookGitHub.fileToBase64(file);
    await window.CookbookSync.writeBase64(destPath, base64, message);
  }

  async function saveRecipe(event) {
    event.preventDefault();
    const status = qs("[data-status]");
    const title = qs("#title").value.trim();
    const categoryIds = selectedCategoryIds.slice();
    if (!title) {
      showStatus(status, "O título é obrigatório.", "error");
      return;
    }
    if (!categoryIds.length) {
      showStatus(status, "Escolha ao menos uma categoria.", "error");
      return;
    }

    const groups = readGroupsFromDom().filter((g) => g.name || g.ingredients.length || g.steps.length);
    if (!groups.length) {
      showStatus(status, "Adicione pelo menos um grupo.", "error");
      return;
    }
    if (groups.some((g) => !g.steps.length)) {
      showStatus(status, "Cada grupo precisa de pelo menos um passo.", "error");
      return;
    }

    try {
      const ok = await assertNameAvailable(recipeIndex, title, {
        excludeId: editingId,
        nameKey: "title",
        label: "uma receita",
      });
      if (!ok) return;
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      return;
    }

    const existingIds = new Set(recipeIndex.map((r) => r.id));
    if (editingId) existingIds.delete(editingId);
    const id = editingId || window.CookbookData.uniqueId(title, existingIds);

    const submit = qs("[data-recipe-save]");
    if (submit) submit.disabled = true;
    showStatus(status, "Salvando neste dispositivo…", "info");

    try {
      let imagePath = imageCleared ? "" : savedImagePath;
      if (imageFile) {
        const ext = window.CookbookGitHub.extensionForFile(imageFile);
        imagePath = `data/images/recipes/${id}${ext}`;
        const base64 = await window.CookbookGitHub.fileToBase64(imageFile);
        await window.CookbookSync.writeBase64(
          imagePath,
          base64,
          `Atualizar imagem da receita: ${title}`
        );
        if (
          editingId &&
          savedImagePath &&
          savedImagePath !== imagePath &&
          savedImagePath.startsWith("data/images/recipes/")
        ) {
          await window.CookbookSync.remove(
            savedImagePath,
            `Remover imagem anterior da receita ${id}`
          );
        }
      } else if (
        editingId &&
        imageCleared &&
        savedImagePath.startsWith("data/images/recipes/")
      ) {
        await window.CookbookSync.remove(
          savedImagePath,
          `Remover imagem da receita ${id}`
        );
      } else if (
        !editingId &&
        !imageCleared &&
        savedImagePath &&
        savedImagePath.startsWith("data/images/recipes/")
      ) {
        const ext = extensionFromPath(savedImagePath);
        imagePath = `data/images/recipes/${id}${ext}`;
        if (imagePath !== savedImagePath) {
          await copyRecipeImage(
            savedImagePath,
            imagePath,
            `Copiar imagem da receita: ${title}`
          );
        }
      }

      const recipe = {
        id,
        title,
        categoryIds,
        image: imagePath,
        groups,
        updatedAt: new Date().toISOString(),
      };

      await window.CookbookSync.writeJson(
        `data/recipes/${id}.json`,
        recipe,
        `${editingId ? "Atualizar" : "Adicionar"} receita: ${title}`
      );

      const nextIndex = window.CookbookData.sortByName(
        [
          ...recipeIndex.filter((r) => r.id !== id),
          {
            id,
            title,
            categoryIds,
            image: imagePath,
          },
        ],
        "title"
      );
      recipeIndex = nextIndex;
      await window.CookbookSync.writeJson(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após ${title}`
      );

      clearDirty();
      allowLeave = true;
      showStatus(status, "Salvo neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
      window.CookbookUI?.nudgeSync?.();
      window.setTimeout(() => {
        if (inBookMode && window.CookbookBook?.openRecipe) {
          void window.CookbookBook.openRecipe(id);
          return;
        }
        if (inBookMode) {
          requestClose();
          return;
        }
        window.location.href = `recipe.html?id=${encodeURIComponent(id)}`;
      }, 900);
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      if (submit) submit.disabled = false;
    }
  }

  async function deleteRecipe() {
    if (!editingId) return;
    if (!window.confirm("Excluir esta receita?")) return;
    const status = qs("[data-status]");
    showStatus(status, "Excluindo…", "info");
    try {
      await window.CookbookSync.remove(
        `data/recipes/${editingId}.json`,
        `Excluir receita ${editingId}`
      );
      if (savedImagePath && savedImagePath.startsWith("data/images/recipes/")) {
        await window.CookbookSync.remove(
          savedImagePath,
          `Excluir imagem da receita ${editingId}`
        );
      }
      const nextIndex = window.CookbookData.sortByName(
        recipeIndex.filter((r) => r.id !== editingId),
        "title"
      );
      recipeIndex = nextIndex;
      await window.CookbookSync.writeJson(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após excluir ${editingId}`
      );
      clearDirty();
      allowLeave = true;
      window.CookbookUI?.nudgeSync?.();
      if (inBookMode) {
        requestClose();
        return;
      }
      window.CookbookAuth.markOpenedEntry();
      window.location.href = "index.html?home=1";
    } catch (err) {
      showStatus(status, err.message || "Falha ao excluir.", "error");
    }
  }

  function bindLeaveGuard() {
    if (leaveGuardBound) return;
    leaveGuardBound = true;

    window.addEventListener("beforeunload", (event) => {
      if (!dirty || allowLeave || !qs("#recipe-form")) return;
      event.preventDefault();
      event.returnValue = "";
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!dirty || allowLeave || !qs("#recipe-form")) return;
        const link = event.target.closest("a[href]");
        if (!link) return;
        if (link.target === "_blank" || link.hasAttribute("download")) return;
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

        let nextUrl;
        try {
          nextUrl = new URL(href, window.location.href);
        } catch {
          return;
        }
        if (nextUrl.href === window.location.href) return;

        event.preventDefault();
        event.stopPropagation();
        openLeaveModal(nextUrl.href);
      },
      true
    );
  }

  function bindFormHandlers() {
    const form = qs("#recipe-form");
    if (!form) return;
    form.onsubmit = saveRecipe;
    form.oninput = markDirty;
    form.onchange = markDirty;
    const categoryTrigger = qs("[data-category-trigger]");
    if (categoryTrigger) {
      categoryTrigger.onclick = () => {
        openPickModal(null, "category");
      };
    }
    const chips = qs("[data-category-chips]");
    if (chips) {
      chips.onclick = (event) => {
        const btn = event.target.closest("[data-remove-category]");
        if (!btn) return;
        removeCategoryId(btn.getAttribute("data-remove-category"));
        markDirty();
      };
    }
    qs("[data-add-group]").onclick = () => {
      const groups = readGroupsFromDom({ keepEmpty: true });
      groups.push(blankGroup());
      markDirty();
      renderGroups(groups, { focus: { type: "group" } });
    };
    const del = qs("[data-delete]");
    if (del) del.onclick = deleteRecipe;
    bindLeaveGuard();
  }

  function attemptClose() {
    if (dirty && !allowLeave) {
      openLeaveModal(inBookMode ? "__close__" : "index.html?home=1");
      return;
    }
    requestClose();
  }

  function decorateRecipeActionIcons() {
    const submit = qs("[data-recipe-save]");
    if (submit) submit.innerHTML = window.CookbookIcons.save();
    const del = qs("[data-delete]");
    if (del) del.innerHTML = window.CookbookIcons.delete();
  }

  async function bootEditor({ skipShell = false } = {}) {
    if (skipShell) {
      if (!window.CookbookAuth.isCook()) return;
    } else if (!window.CookbookAuth.requireCookOrRedirect()) {
      return;
    } else {
      window.CookbookUI.mountShell({ active: "edit" });
    }
    ensureModals();

    [categories, measures, ingredients, recipeIndex] = await Promise.all([
      window.CookbookData.loadCategories(),
      window.CookbookData.loadMeasures(),
      window.CookbookData.loadIngredientIndex(),
      window.CookbookData.loadRecipeIndex(),
    ]);

    qs("#page-title").textContent = editingId ? "Editar receita" : "Nova receita";
    qs("[data-delete]")?.toggleAttribute("hidden", !editingId);
    decorateRecipeActionIcons();

    recipeImagePicker = mountImagePicker(qs("[data-recipe-image]"), {
      onChange: (file) => {
        imageFile = file;
        imageCleared = !file;
        markDirty();
      },
    });

    if (editingId) {
      const recipe = await window.CookbookData.loadRecipe(editingId);
      await fillForm(recipe);
    } else if (duplicateFromId) {
      const recipe = await window.CookbookData.loadRecipe(duplicateFromId);
      await fillForm(recipe);
      markDirty();
      showStatus(qs("[data-status]"), "Altere o título para salvar a cópia.", "info");
    } else {
      await fillForm({ title: "", categoryIds: [], image: "", groups: [blankGroup()] });
    }

    bindFormHandlers();
  }

  async function mountInBook(_host, { id = null, from = null, onClose } = {}) {
    inBookMode = true;
    onCloseCb = onClose || null;
    editingId = id || null;
    duplicateFromId = editingId ? null : from || null;
    allowLeave = false;
    clearDirty();
    await bootEditor({ skipShell: true });
  }

  function unmountFromBook() {
    inBookMode = false;
    onCloseCb = null;
    editingId = null;
    duplicateFromId = null;
    clearDirty();
    allowLeave = true;
    recipeImagePicker = null;
    imageFile = null;
    imageCleared = false;
    savedImagePath = "";
  }

  async function boot() {
    inBookMode = false;
    editingId = params.get("id");
    duplicateFromId = editingId ? null : params.get("from");
    await bootEditor({ skipShell: false });
  }

  window.CookbookEditRecipe = {
    formShellHtml,
    mountInBook,
    unmountFromBook,
    attemptClose,
  };

  window.addEventListener("cookbook:ready", () => {
    if (document.querySelector("[data-book]")) return;
    boot().catch((err) => {
      showStatus(qs("[data-status]"), err.message, "error");
    });
  });
  if (!document.querySelector("[data-book]")) {
    window.CookbookAuth.ensureSession();
  }
})();
