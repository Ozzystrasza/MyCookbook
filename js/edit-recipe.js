(function () {
  const { qs, showStatus, mountImagePicker } = window.CookbookUI;
  const params = new URLSearchParams(window.location.search);
  const editingId = params.get("id");

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
  let createTargetInput = null;
  let recipeImagePicker = null;
  let createImagePicker = null;
  let createImageFile = null;

  let leaveModal = null;
  let pickModal = null;
  let createModal = null;

  function blankGroup() {
    return {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "",
      ingredients: [{ ingredientId: "", measureId: "", quantity: "" }],
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

  function optionList(items, selected, labelKey = "name") {
    return [
      `<option value="">Selecione…</option>`,
      ...items.map(
        (item) =>
          `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item[labelKey])}</option>`
      ),
    ].join("");
  }

  function ingredientLabel(id) {
    if (!id) return "";
    return ingredients.find((item) => item.id === id)?.name || id;
  }

  function plusIcon() {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
  }

  function minusIcon() {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
  }

  function chevronIcon() {
    return `<svg class="ingredient-picker__chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function closeIcon() {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
  }

  function setPickerValue(input, id) {
    input.value = id || "";
    const trigger =
      input.closest(".line-row__ipicker")?.querySelector("[data-ingredient-trigger]") ||
      input.closest(".line-row")?.querySelector("[data-ingredient-trigger]");
    const valueEl = trigger?.querySelector(".ingredient-picker__value");
    if (!valueEl) return;
    const label = ingredientLabel(id);
    if (label) {
      valueEl.textContent = label;
      valueEl.classList.remove("is-placeholder");
    } else {
      valueEl.textContent = "Selecione…";
      valueEl.classList.add("is-placeholder");
    }
  }

  function refreshAllPickers() {
    qs("[data-groups-editor]")
      ?.querySelectorAll('[data-field="ingredientId"]')
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
      const href = pendingLeaveHref || "index.html";
      pendingLeaveHref = "";
      closeLeaveModal();
      window.location.href = href;
    });

    pickModal = document.createElement("div");
    pickModal.className = "shopping-modal";
    pickModal.hidden = true;
    pickModal.innerHTML = `
      <div class="shopping-modal__backdrop" data-pick-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-label="Escolher ingrediente" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title">Ingrediente</h2>
          <button type="button" class="icon-btn" data-pick-close aria-label="Fechar">${closeIcon()}</button>
        </div>
        <label class="shopping-modal__search">
          <span class="visually-hidden">Buscar ingrediente</span>
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
        closePickModal();
        openCreateModal(target);
        return;
      }
      const pickBtn = event.target.closest("[data-pick-id]");
      if (!pickBtn || !pickerTargetInput) return;
      setPickerValue(pickerTargetInput, pickBtn.getAttribute("data-pick-id"));
      markDirty();
      closePickModal();
    });

    createModal = document.createElement("div");
    createModal.className = "shopping-modal";
    createModal.hidden = true;
    createModal.innerHTML = `
      <div class="shopping-modal__backdrop" data-create-close tabindex="-1"></div>
      <div class="shopping-modal__panel" role="dialog" aria-labelledby="create-ingredient-title" aria-modal="true">
        <div class="shopping-modal__header">
          <h2 class="shopping-modal__title" id="create-ingredient-title">Novo ingrediente</h2>
          <button type="button" class="icon-btn" data-create-close aria-label="Fechar">${closeIcon()}</button>
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
    createImagePicker = mountImagePicker(createModal.querySelector("[data-create-image]"), {
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
      if (!createModal.hidden) {
        closeCreateModal();
        return;
      }
      if (!pickModal.hidden) closePickModal();
    });
  }

  function closeLeaveModal() {
    leaveModal.hidden = true;
    pendingLeaveHref = "";
  }

  function openLeaveModal(href) {
    ensureModals();
    pendingLeaveHref = href;
    leaveModal.hidden = false;
  }

  function closePickModal() {
    pickModal.hidden = true;
    pickerTargetInput = null;
    const search = pickModal.querySelector("[data-pick-search]");
    if (search) search.value = "";
  }

  function openPickModal(input) {
    ensureModals();
    pickerTargetInput = input;
    pickModal.hidden = false;
    renderPickList();
    window.setTimeout(() => pickModal.querySelector("[data-pick-search]")?.focus(), 30);
  }

  function closeCreateModal() {
    createModal.hidden = true;
    createTargetInput = null;
    createImageFile = null;
    createImagePicker?.setUrl("");
    const form = createModal.querySelector("[data-create-form]");
    form?.reset();
    showStatus(createModal.querySelector("[data-create-status]"), "", "info");
    const submit = form?.querySelector('[type="submit"]');
    if (submit) submit.disabled = false;
  }

  function openCreateModal(input) {
    ensureModals();
    createTargetInput = input;
    createModal.hidden = false;
    window.setTimeout(() => createModal.querySelector("[data-create-name]")?.focus(), 30);
  }

  function renderPickList() {
    const list = pickModal.querySelector("[data-pick-list]");
    const query = (pickModal.querySelector("[data-pick-search]")?.value || "").trim().toLowerCase();
    const filtered = ingredients.filter((item) => !query || String(item.name || "").toLowerCase().includes(query));
    const rows = filtered
      .map(
        (item) => `
        <button type="button" class="shopping-catalog-item" data-pick-id="${escapeHtml(item.id)}">
          <img src="${escapeHtml(item.image || "")}" alt="" />
          <span>${escapeHtml(item.name || item.id)}</span>
        </button>`
      )
      .join("");
    list.innerHTML = `
      ${rows}
      <button type="button" class="shopping-catalog-item shopping-catalog-item--action" data-pick-create>
        <span class="shopping-catalog-item__icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
          </svg>
        </span>
        <span>Novo Ingrediente</span>
      </button>
    `;
  }

  async function saveNewIngredient(event) {
    event.preventDefault();
    const status = createModal.querySelector("[data-create-status]");
    const submit = createModal.querySelector('[type="submit"]');
    const name = createModal.querySelector("[data-create-name]").value.trim();
    const file = createImageFile || createImagePicker?.getFile() || null;
    if (!name) {
      showStatus(status, "Informe o nome do ingrediente.", "error");
      return;
    }

    const token = window.CookbookAuth.getToken();
    const existingIds = new Set(ingredients.map((i) => i.id));
    const id = window.CookbookData.uniqueId(name, existingIds);
    let imagePath = "";

    submit.disabled = true;
    showStatus(status, "Salvando ingrediente…", "info");

    try {
      if (file) {
        const ext = window.CookbookGitHub.extensionForFile(file);
        imagePath = `data/images/ingredients/${id}${ext}`;
        const base64 = await window.CookbookGitHub.fileToBase64(file);
        await window.CookbookGitHub.putFile(
          imagePath,
          base64,
          `Atualizar imagem do ingrediente: ${name}`,
          token,
          (await window.CookbookGitHub.getFile(imagePath, token))?.sha
        );
      }

      const record = { id, name, image: imagePath };
      await window.CookbookGitHub.putJsonFile(
        `data/ingredients/${id}.json`,
        record,
        `Adicionar ingrediente: ${name}`,
        token
      );

      ingredients.push(record);
      await window.CookbookGitHub.putJsonFile(
        "data/ingredients/_index.json",
        ingredients,
        `Atualizar índice de ingredientes após ${name}`,
        token
      );

      const target = createTargetInput;
      closeCreateModal();
      refreshAllPickers();
      if (target) {
        setPickerValue(target, id);
        markDirty();
      }
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar ingrediente.", "error");
      submit.disabled = false;
    }
  }

  function renderGroups(groups) {
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
      const ingredientLines = group.ingredients?.length
        ? group.ingredients
        : [{ ingredientId: "", measureId: "", quantity: "" }];
      ingredientLines.forEach((line, lineIndex) => {
        const row = document.createElement("div");
        row.className = "line-row ingredients";
        const selectedLabel = ingredientLabel(line.ingredientId);
        row.innerHTML = `
          <span class="field-label line-row__ilabel">Ingrediente</span>
          <div class="actions actions--row">
            <button type="button" class="icon-btn" data-remove-ingredient aria-label="Remover ingrediente" title="Remover">${minusIcon()}</button>
          </div>
          <div class="line-row__ipicker">
            <input type="hidden" data-field="ingredientId" value="${escapeHtml(line.ingredientId || "")}" />
            <button type="button" class="ingredient-picker__trigger" data-ingredient-trigger aria-haspopup="dialog">
              <span class="ingredient-picker__value ${selectedLabel ? "" : "is-placeholder"}">${escapeHtml(selectedLabel || "Selecione…")}</span>
              ${chevronIcon()}
            </button>
          </div>
          <span class="field-label line-row__mlabel">Medida</span>
          <select class="field-control line-row__mctrl" data-field="measureId">${optionList(measures, line.measureId)}</select>
          <span class="field-label line-row__qlabel">Quantidade</span>
          <input class="field-control line-row__qctrl" data-field="quantity" value="${escapeHtml(line.quantity ?? "")}" placeholder="2 ou 1/2" />
        `;
        row.querySelector("[data-ingredient-trigger]").addEventListener("click", () => {
          openPickModal(row.querySelector('[data-field="ingredientId"]'));
        });
        row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
          const current = readGroupsFromDom({ keepEmpty: true });
          current[groupIndex].ingredients.splice(lineIndex, 1);
          if (!current[groupIndex].ingredients.length) {
            current[groupIndex].ingredients.push({ ingredientId: "", measureId: "", quantity: "" });
          }
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
        row.innerHTML = `
          <span class="field-label line-row__slabel">Passo</span>
          <div class="actions actions--row">
            <button type="button" class="icon-btn" data-remove-step aria-label="Remover passo" title="Remover">${minusIcon()}</button>
          </div>
          <textarea class="field-control line-row__sctrl" data-field="description" placeholder="O que fazer…">${escapeHtml(step.description || "")}</textarea>
        `;
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
        renderGroups(current);
      });
      wrap.querySelector("[data-add-step]").addEventListener("click", () => {
        const current = readGroupsFromDom({ keepEmpty: true });
        current[groupIndex].steps.push({ description: "" });
        markDirty();
        renderGroups(current);
      });
      wrap.querySelector("[data-remove-group]").addEventListener("click", () => {
        const current = readGroupsFromDom({ keepEmpty: true });
        current.splice(groupIndex, 1);
        markDirty();
        renderGroups(current.length ? current : [blankGroup()]);
      });

      host.append(wrap);
    });
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

  function fillForm(recipe) {
    qs("#title").value = recipe.title || "";
    qs("#categoryId").innerHTML = optionList(categories, recipe.categoryId);
    savedImagePath = recipe.image || "";
    imageFile = null;
    imageCleared = false;
    recipeImagePicker?.setUrl(savedImagePath);
    renderGroups(recipe.groups?.length ? recipe.groups : [blankGroup()]);
    clearDirty();
  }

  async function saveRecipe(event) {
    event.preventDefault();
    const status = qs("[data-status]");
    const token = window.CookbookAuth.getToken();
    const title = qs("#title").value.trim();
    const categoryId = qs("#categoryId").value;
    if (!title) {
      showStatus(status, "O título é obrigatório.", "error");
      return;
    }
    if (!categoryId) {
      showStatus(status, "Escolha uma categoria.", "error");
      return;
    }

    const groups = readGroupsFromDom().filter((g) => g.name || g.ingredients.length || g.steps.length);
    if (!groups.length) {
      showStatus(status, "Adicione pelo menos um grupo.", "error");
      return;
    }

    const existingIds = new Set(recipeIndex.map((r) => r.id));
    if (editingId) existingIds.delete(editingId);
    const id = editingId || window.CookbookData.uniqueId(title, existingIds);

    const submit = qs('[type="submit"]');
    submit.disabled = true;
    showStatus(status, "Salvando no GitHub…", "info");

    try {
      let imagePath = imageCleared ? "" : savedImagePath;
      if (imageFile) {
        const ext = window.CookbookGitHub.extensionForFile(imageFile);
        imagePath = `data/images/recipes/${id}${ext}`;
        const base64 = await window.CookbookGitHub.fileToBase64(imageFile);
        await window.CookbookGitHub.putFile(
          imagePath,
          base64,
          `Atualizar imagem da receita: ${title}`,
          token,
          (await window.CookbookGitHub.getFile(imagePath, token))?.sha
        );
        if (
          savedImagePath &&
          savedImagePath !== imagePath &&
          savedImagePath.startsWith("data/images/recipes/")
        ) {
          await window.CookbookGitHub.deleteFile(
            savedImagePath,
            `Remover imagem anterior da receita ${id}`,
            token
          );
        }
      } else if (imageCleared && savedImagePath.startsWith("data/images/recipes/")) {
        await window.CookbookGitHub.deleteFile(
          savedImagePath,
          `Remover imagem da receita ${id}`,
          token
        );
      }

      const recipe = {
        id,
        title,
        categoryId,
        image: imagePath,
        groups,
        updatedAt: new Date().toISOString(),
      };

      await window.CookbookGitHub.putJsonFile(
        `data/recipes/${id}.json`,
        recipe,
        `${editingId ? "Atualizar" : "Adicionar"} receita: ${title}`,
        token
      );

      const nextIndex = recipeIndex.filter((r) => r.id !== id);
      nextIndex.unshift({
        id,
        title,
        categoryId,
        image: imagePath,
      });
      await window.CookbookGitHub.putJsonFile(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após ${title}`,
        token
      );

      clearDirty();
      allowLeave = true;
      showStatus(status, "Salvo. O GitHub Pages pode levar um minuto para atualizar.", "ok");
      window.setTimeout(() => {
        window.location.href = `recipe.html?id=${encodeURIComponent(id)}`;
      }, 900);
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      submit.disabled = false;
    }
  }

  async function deleteRecipe() {
    if (!editingId) return;
    if (!window.confirm("Excluir esta receita do repositório?")) return;
    const status = qs("[data-status]");
    const token = window.CookbookAuth.getToken();
    showStatus(status, "Excluindo…", "info");
    try {
      await window.CookbookGitHub.deleteFile(
        `data/recipes/${editingId}.json`,
        `Excluir receita ${editingId}`,
        token
      );
      if (savedImagePath && savedImagePath.startsWith("data/images/recipes/")) {
        await window.CookbookGitHub.deleteFile(
          savedImagePath,
          `Excluir imagem da receita ${editingId}`,
          token
        );
      }
      const nextIndex = recipeIndex.filter((r) => r.id !== editingId);
      await window.CookbookGitHub.putJsonFile(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após excluir ${editingId}`,
        token
      );
      clearDirty();
      allowLeave = true;
      window.location.href = "index.html";
    } catch (err) {
      showStatus(status, err.message || "Falha ao excluir.", "error");
    }
  }

  function bindLeaveGuard() {
    const form = qs("#recipe-form");
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);

    window.addEventListener("beforeunload", (event) => {
      if (!dirty || allowLeave) return;
      event.preventDefault();
      event.returnValue = "";
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!dirty || allowLeave) return;
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

  async function boot() {
    if (!window.CookbookAuth.requireCookOrRedirect()) return;
    window.CookbookUI.mountShell({ active: "edit" });
    ensureModals();

    [categories, measures, ingredients, recipeIndex] = await Promise.all([
      window.CookbookData.loadCategories(),
      window.CookbookData.loadMeasures(),
      window.CookbookData.loadIngredientIndex(),
      window.CookbookData.loadRecipeIndex(),
    ]);

    qs("#page-title").textContent = editingId ? "Editar receita" : "Nova receita";
    qs("[data-delete]")?.toggleAttribute("hidden", !editingId);

    recipeImagePicker = mountImagePicker(qs("[data-recipe-image]"), {
      onChange: (file) => {
        imageFile = file;
        imageCleared = !file;
        markDirty();
      },
    });

    if (editingId) {
      const recipe = await window.CookbookData.loadRecipe(editingId);
      fillForm(recipe);
    } else {
      fillForm({ title: "", categoryId: "", image: "", groups: [blankGroup()] });
    }

    qs("#recipe-form").addEventListener("submit", saveRecipe);
    qs("[data-add-group]").addEventListener("click", () => {
      const groups = readGroupsFromDom({ keepEmpty: true });
      groups.push(blankGroup());
      markDirty();
      renderGroups(groups);
    });
    qs("[data-delete]")?.addEventListener("click", deleteRecipe);
    bindLeaveGuard();
  }

  window.addEventListener("cookbook:ready", () => {
    boot().catch((err) => {
      showStatus(qs("[data-status]"), err.message, "error");
    });
  });
  window.CookbookAuth.ensureSession();
})();
