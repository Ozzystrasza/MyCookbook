(function () {
  const { qs, showStatus, mountImagePicker, assertNameAvailable, escapeHtml } = window.CookbookUI;
  let categories = [];
  let measures = [];
  let ingredients = [];
  let activeTab = "categories";
  let editingCategoryId = null;
  let editingMeasureId = null;
  let editingIngredientId = null;
  let ingredientImagePicker = null;
  let ingredientImageFile = null;
  let ingredientImageCleared = false;
  let inlineIngredientImagePicker = null;
  let inlineIngredientImageFile = null;
  let inlineIngredientImageCleared = false;
  let inlineIngredientSavedImage = "";
  let inBookMode = false;
  let onCloseCb = null;
  let formHandlersBound = false;
  let addingTab = null;

  function formShellHtml() {
    const add = window.CookbookIcons.add();
    const check = window.CookbookIcons.check();
    const close = window.CookbookIcons.closeSmall();
    return `
      <div class="book-form panel panel--in-book">
        <h1>Gerenciar catálogos</h1>
        <p class="status" data-status hidden></p>
        <div class="tabs" data-tabs>
          <button type="button" class="btn btn--ghost is-active" data-tab="categories">Categorias</button>
          <button type="button" class="btn btn--ghost" data-tab="measures">Medidas</button>
          <button type="button" class="btn btn--ghost" data-tab="ingredients">Ingredientes</button>
        </div>
        <div data-panel-categories>
          <div class="actions actions--sticky">
            <button type="button" class="icon-btn icon-btn--primary" data-open-add="categories" aria-label="Adicionar categoria" title="Adicionar categoria">${add}</button>
          </div>
          <div class="catalog-add" data-add-panel="categories" hidden>
            <form id="category-form" class="stack">
              <label class="field">
                <span>Nome</span>
                <input id="category-name" required placeholder="Sobremesas" />
              </label>
              <div class="catalog-add__actions">
                <button type="submit" class="icon-btn icon-btn--primary" aria-label="Confirmar" title="Confirmar">${check}</button>
                <button type="button" class="icon-btn" data-cancel-add="categories" aria-label="Cancelar" title="Cancelar">${close}</button>
              </div>
            </form>
          </div>
          <div class="catalog-grid" data-category-list></div>
        </div>
        <div data-panel-measures hidden>
          <div class="actions actions--sticky">
            <button type="button" class="icon-btn icon-btn--primary" data-open-add="measures" aria-label="Adicionar medida" title="Adicionar medida">${add}</button>
          </div>
          <div class="catalog-add" data-add-panel="measures" hidden>
            <form id="measure-form" class="stack">
              <div class="row row--2">
                <label class="field">
                  <span>Nome</span>
                  <input id="measure-name" required placeholder="colher de sopa" />
                </label>
                <label class="field">
                  <span>Abreviação</span>
                  <input id="measure-abbrev" placeholder="c.s." />
                </label>
              </div>
              <div class="catalog-add__actions">
                <button type="submit" class="icon-btn icon-btn--primary" aria-label="Confirmar" title="Confirmar">${check}</button>
                <button type="button" class="icon-btn" data-cancel-add="measures" aria-label="Cancelar" title="Cancelar">${close}</button>
              </div>
            </form>
          </div>
          <div class="catalog-grid" data-measure-list></div>
        </div>
        <div data-panel-ingredients hidden>
          <div class="actions actions--sticky">
            <button type="button" class="icon-btn icon-btn--primary" data-open-add="ingredients" aria-label="Adicionar ingrediente" title="Adicionar ingrediente">${add}</button>
          </div>
          <div class="catalog-add" data-add-panel="ingredients" hidden>
            <form id="ingredient-form" class="stack">
              <label class="field">
                <span>Nome</span>
                <input id="ingredient-name" required placeholder="Farinha de trigo" />
              </label>
              <div class="field">
                <span>Foto</span>
                <div data-ingredient-image></div>
              </div>
              <div class="catalog-add__actions">
                <button type="submit" class="icon-btn icon-btn--primary" aria-label="Confirmar" title="Confirmar">${check}</button>
                <button type="button" class="icon-btn" data-cancel-add="ingredients" aria-label="Cancelar" title="Cancelar">${close}</button>
              </div>
            </form>
          </div>
          <div class="catalog-grid" data-ingredient-list></div>
        </div>
      </div>
    `;
  }

  function nameInputForTab(tab) {
    if (tab === "categories") return qs("#category-name");
    if (tab === "measures") return qs("#measure-name");
    return qs("#ingredient-name");
  }

  function openAddPanel(tab) {
    if (addingTab && addingTab !== tab) closeAddPanel(addingTab);
    addingTab = tab;
    const panel = qs(`[data-add-panel="${tab}"]`);
    if (panel) panel.hidden = false;
    requestAnimationFrame(() => {
      const input = nameInputForTab(tab);
      input?.focus();
      input?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function closeAddPanel(tab = addingTab) {
    if (!tab) return;
    const panel = qs(`[data-add-panel="${tab}"]`);
    if (panel) panel.hidden = true;
    if (tab === "categories") resetCategoryForm();
    else if (tab === "measures") resetMeasureForm();
    else if (tab === "ingredients") resetIngredientForm();
    if (addingTab === tab) addingTab = null;
  }

  function setTab(tab) {
    if (tab !== activeTab) {
      cancelInlineEdits({ reRender: true });
      closeAddPanel();
    }
    activeTab = tab;
    qs("[data-tabs]").querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
    qs("[data-panel-categories]").hidden = tab !== "categories";
    qs("[data-panel-measures]").hidden = tab !== "measures";
    qs("[data-panel-ingredients]").hidden = tab !== "ingredients";
  }

  function formatUsageList(titles) {
    const sorted = titles.slice().sort((a, b) =>
      String(a || "").localeCompare(String(b || ""), "pt", { sensitivity: "base" })
    );
    const shown = sorted.slice(0, 5);
    const extra = sorted.length - shown.length;
    const label = shown.join(", ");
    return extra > 0 ? `${label} e mais ${extra}` : label;
  }

  async function findRecipesUsing({ categoryId = null, measureId = null, ingredientId = null } = {}) {
    const index = await window.CookbookData.loadRecipeIndex();
    const hits = [];
    const needFull = Boolean(measureId || ingredientId);

    if (categoryId && !needFull) {
      index.forEach((meta) => {
        if (meta.categoryId === categoryId) hits.push(meta.title || meta.id);
      });
      return hits;
    }

    const recipes = await Promise.all(
      index.map(async (meta) => {
        try {
          const recipe = await window.CookbookData.loadRecipe(meta.id);
          return { meta, recipe };
        } catch (_) {
          return { meta, recipe: null };
        }
      })
    );

    recipes.forEach(({ meta, recipe }) => {
      if (categoryId && (recipe?.categoryId || meta.categoryId) === categoryId) {
        hits.push(meta.title || meta.id);
        return;
      }
      if (!recipe?.groups || (!measureId && !ingredientId)) return;
      const used = recipe.groups.some((group) =>
        (group.ingredients || []).some((line) => {
          if (ingredientId && line.ingredientId === ingredientId) return true;
          if (measureId && line.measureId === measureId) return true;
          return false;
        })
      );
      if (used) hits.push(meta.title || meta.id);
    });

    return hits;
  }

  function clearInlineIngredientPicker() {
    inlineIngredientImagePicker = null;
    inlineIngredientImageFile = null;
    inlineIngredientImageCleared = false;
    inlineIngredientSavedImage = "";
  }

  function cancelInlineEdits({ reRender = true } = {}) {
    const hadCategory = editingCategoryId;
    const hadMeasure = editingMeasureId;
    const hadIngredient = editingIngredientId;
    editingCategoryId = null;
    editingMeasureId = null;
    editingIngredientId = null;
    clearInlineIngredientPicker();
    if (!reRender) return;
    if (hadCategory) renderCategories();
    if (hadMeasure) renderMeasures();
    if (hadIngredient) renderIngredients();
  }

  function focusInlineName(list) {
    requestAnimationFrame(() => {
      list?.querySelector("[data-inline-name]")?.focus();
    });
  }

  function bindInlineEnterConfirm(list, confirmFn) {
    list.querySelectorAll("[data-inline-name], [data-inline-abbrev]").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void confirmFn();
      });
    });
  }

  function actionButtons({ editAttr, editId, deleteAttr, deleteId, editing }) {
    if (editing) {
      return `
        <button type="button" class="icon-btn" data-confirm-${editAttr}="${escapeHtml(editId)}" aria-label="Confirmar" title="Confirmar">${window.CookbookIcons.check()}</button>
        <button type="button" class="icon-btn" data-cancel-${editAttr}="${escapeHtml(editId)}" aria-label="Cancelar" title="Cancelar">${window.CookbookIcons.closeSmall()}</button>
      `;
    }
    return `
      <button type="button" class="icon-btn" data-edit-${editAttr}="${escapeHtml(editId)}" aria-label="Editar" title="Editar">${window.CookbookIcons.edit()}</button>
      <button type="button" class="icon-btn" data-delete-${deleteAttr}="${escapeHtml(deleteId)}" aria-label="Excluir" title="Excluir">${window.CookbookIcons.delete()}</button>
    `;
  }

  function byName(a, b) {
    return window.CookbookData.compareByName(a, b);
  }

  function renderCategories() {
    const list = qs("[data-category-list]");
    if (!categories.length) {
      editingCategoryId = null;
      list.innerHTML = `<div class="empty empty--with-action catalog-empty">
        <p>Nenhuma categoria ainda.</p>
        <button type="button" class="btn btn--primary" data-open-add-cta="categories">Adicionar categoria</button>
      </div>`;
      list.querySelector("[data-open-add-cta]")?.addEventListener("click", () => {
        openAddPanel("categories");
      });
      return;
    }
    list.innerHTML = categories
      .slice()
      .sort(byName)
      .map((item) => {
        const editing = editingCategoryId === item.id;
        if (editing) {
          return `
      <div class="catalog-card is-editing">
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <label class="field">
              <span class="visually-hidden">Nome</span>
              <input data-inline-name type="text" required value="${escapeHtml(item.name)}" aria-label="Nome da categoria" />
            </label>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "category", editId: item.id, deleteAttr: "category", deleteId: item.id, editing: true })}
          </div>
        </div>
      </div>`;
        }
        return `
      <div class="catalog-card">
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <strong>${escapeHtml(item.name)}</strong>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "category", editId: item.id, deleteAttr: "category", deleteId: item.id, editing: false })}
          </div>
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll("[data-edit-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingCategoryId = btn.dataset.editCategory;
        renderCategories();
        focusInlineName(list);
      });
    });

    list.querySelectorAll("[data-cancel-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingCategoryId = null;
        renderCategories();
      });
    });

    const confirmCategory = async () => {
      const status = qs("[data-status]");
      const id = editingCategoryId;
      if (!id) return;
      const name = list.querySelector("[data-inline-name]")?.value.trim() || "";
      if (!name) return;
      try {
        const ok = await assertNameAvailable(categories, name, {
          excludeId: id,
          label: "uma categoria",
        });
        if (!ok) return;
        const existing = categories.find((c) => c.id === id);
        if (!existing) return;
        existing.name = name;
        editingCategoryId = null;
        await saveCategories(`Atualizar categoria ${id}`);
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    list.querySelectorAll("[data-confirm-category]").forEach((btn) => {
      btn.addEventListener("click", () => void confirmCategory());
    });
    bindInlineEnterConfirm(list, confirmCategory);

    list.querySelectorAll("[data-delete-category]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteCategory;
        const status = qs("[data-status]");
        try {
          const refs = await findRecipesUsing({ categoryId: id });
          if (refs.length) {
            showStatus(
              status,
              `Não é possível excluir: usada em ${formatUsageList(refs)}.`,
              "error"
            );
            return;
          }
          if (!window.confirm("Excluir esta categoria?")) return;
          if (editingCategoryId === id) editingCategoryId = null;
          categories = categories.filter((c) => c.id !== id);
          await saveCategories("Excluir categoria");
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });
  }

  function renderMeasures() {
    const list = qs("[data-measure-list]");
    if (!measures.length) {
      editingMeasureId = null;
      list.innerHTML = `<div class="empty empty--with-action catalog-empty">
        <p>Nenhuma medida ainda.</p>
        <button type="button" class="btn btn--primary" data-open-add-cta="measures">Adicionar medida</button>
      </div>`;
      list.querySelector("[data-open-add-cta]")?.addEventListener("click", () => {
        openAddPanel("measures");
      });
      return;
    }
    list.innerHTML = measures
      .slice()
      .sort(byName)
      .map((item) => {
        const editing = editingMeasureId === item.id;
        if (editing) {
          return `
      <div class="catalog-card is-editing">
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <label class="field">
              <span class="visually-hidden">Nome</span>
              <input data-inline-name type="text" required value="${escapeHtml(item.name)}" aria-label="Nome da medida" />
            </label>
            <label class="field">
              <span class="visually-hidden">Abreviação</span>
              <input data-inline-abbrev type="text" value="${escapeHtml(item.abbrev || "")}" placeholder="Abreviação" aria-label="Abreviação" />
            </label>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "measure", editId: item.id, deleteAttr: "measure", deleteId: item.id, editing: true })}
          </div>
        </div>
      </div>`;
        }
        return `
      <div class="catalog-card">
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="hint">${escapeHtml(item.abbrev || item.id)}</span>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "measure", editId: item.id, deleteAttr: "measure", deleteId: item.id, editing: false })}
          </div>
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll("[data-edit-measure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingMeasureId = btn.dataset.editMeasure;
        renderMeasures();
        focusInlineName(list);
      });
    });

    list.querySelectorAll("[data-cancel-measure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingMeasureId = null;
        renderMeasures();
      });
    });

    const confirmMeasure = async () => {
      const status = qs("[data-status]");
      const id = editingMeasureId;
      if (!id) return;
      const name = list.querySelector("[data-inline-name]")?.value.trim() || "";
      const abbrev = list.querySelector("[data-inline-abbrev]")?.value.trim() || "";
      if (!name) return;
      try {
        const ok = await assertNameAvailable(measures, name, {
          excludeId: id,
          label: "uma medida",
        });
        if (!ok) return;
        const existing = measures.find((m) => m.id === id);
        if (!existing) return;
        existing.name = name;
        existing.abbrev = abbrev || name;
        editingMeasureId = null;
        await saveMeasures(`Atualizar medida ${id}`);
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    list.querySelectorAll("[data-confirm-measure]").forEach((btn) => {
      btn.addEventListener("click", () => void confirmMeasure());
    });
    bindInlineEnterConfirm(list, confirmMeasure);

    list.querySelectorAll("[data-delete-measure]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteMeasure;
        const status = qs("[data-status]");
        try {
          showStatus(status, "Verificando uso da medida…", "info");
          const refs = await findRecipesUsing({ measureId: id });
          if (refs.length) {
            showStatus(
              status,
              `Não é possível excluir: usada em ${formatUsageList(refs)}.`,
              "error"
            );
            return;
          }
          if (!window.confirm("Excluir esta medida?")) return;
          if (editingMeasureId === id) editingMeasureId = null;
          measures = measures.filter((m) => m.id !== id);
          await saveMeasures("Excluir medida");
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });
  }

  async function mountInlineIngredientImage(item) {
    const host = qs("[data-inline-ingredient-image]");
    if (!host) return;
    inlineIngredientSavedImage = item.image || "";
    inlineIngredientImageFile = null;
    inlineIngredientImageCleared = false;
    inlineIngredientImagePicker = mountImagePicker(host, {
      onChange: (file) => {
        inlineIngredientImageFile = file;
        inlineIngredientImageCleared = !file;
      },
    });
    const preview = inlineIngredientSavedImage
      ? await window.CookbookSync.objectUrl(inlineIngredientSavedImage)
      : "";
    inlineIngredientImagePicker?.setUrl(preview);
  }

  function renderIngredients() {
    const list = qs("[data-ingredient-list]");
    if (!ingredients.length) {
      editingIngredientId = null;
      clearInlineIngredientPicker();
      list.innerHTML = `<div class="empty empty--with-action catalog-empty">
        <p>Nenhum ingrediente no catálogo ainda.</p>
        <button type="button" class="btn btn--primary" data-open-add-cta="ingredients">Adicionar ingrediente</button>
      </div>`;
      list.querySelector("[data-open-add-cta]")?.addEventListener("click", () => {
        openAddPanel("ingredients");
      });
      return;
    }

    const editingId = editingIngredientId;
    list.innerHTML = ingredients
      .slice()
      .sort(byName)
      .map((item) => {
        const editing = editingId === item.id;
        if (editing) {
          return `
      <div class="catalog-card is-editing">
        <div class="catalog-card__image-edit" data-inline-ingredient-image></div>
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <label class="field">
              <span class="visually-hidden">Nome</span>
              <input data-inline-name type="text" required value="${escapeHtml(item.name)}" aria-label="Nome do ingrediente" />
            </label>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "ingredient", editId: item.id, deleteAttr: "ingredient", deleteId: item.id, editing: true })}
          </div>
        </div>
      </div>`;
        }
        return `
      <div class="catalog-card">
        ${window.CookbookUI.thumbHtml(item.image, "catalog-card__thumb")}
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <strong>${escapeHtml(item.name)}</strong>
          </div>
          <div class="catalog-card__actions">
            ${actionButtons({ editAttr: "ingredient", editId: item.id, deleteAttr: "ingredient", deleteId: item.id, editing: false })}
          </div>
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll("[data-edit-ingredient]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingIngredientId = btn.dataset.editIngredient;
        renderIngredients();
        focusInlineName(list);
      });
    });

    list.querySelectorAll("[data-cancel-ingredient]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingIngredientId = null;
        clearInlineIngredientPicker();
        renderIngredients();
      });
    });

    const confirmIngredient = async () => {
      const status = qs("[data-status]");
      const id = editingIngredientId;
      if (!id) return;
      const name = list.querySelector("[data-inline-name]")?.value.trim() || "";
      if (!name) return;
      try {
        const ok = await assertNameAvailable(ingredients, name, {
          excludeId: id,
          label: "um ingrediente",
        });
        if (!ok) return;

        const existing = ingredients.find((i) => i.id === id);
        if (!existing) return;

        const file =
          inlineIngredientImageFile || inlineIngredientImagePicker?.getFile() || null;
        const previousImagePath = existing.image || inlineIngredientSavedImage || "";
        let imagePath = inlineIngredientImageCleared ? "" : previousImagePath;

        showStatus(status, "Salvando ingrediente…", "info");

        if (file) {
          const ext = window.CookbookGitHub.extensionForFile(file);
          imagePath = `data/images/ingredients/${id}${ext}`;
          const base64 = await window.CookbookGitHub.fileToBase64(file);
          await window.CookbookSync.writeBase64(
            imagePath,
            base64,
            `Atualizar imagem do ingrediente: ${name}`
          );
          if (
            previousImagePath &&
            previousImagePath !== imagePath &&
            previousImagePath.startsWith("data/images/ingredients/")
          ) {
            await window.CookbookSync.remove(
              previousImagePath,
              `Remover imagem anterior do ingrediente ${id}`
            );
          }
        } else if (
          inlineIngredientImageCleared &&
          previousImagePath.startsWith("data/images/ingredients/")
        ) {
          await window.CookbookSync.remove(
            previousImagePath,
            `Remover imagem do ingrediente ${id}`
          );
        }

        const record = { id, name, image: imagePath };
        await window.CookbookSync.writeJson(
          `data/ingredients/${id}.json`,
          record,
          `Atualizar ingrediente: ${name}`
        );
        existing.name = name;
        existing.image = imagePath;
        ingredients = window.CookbookData.sortByName(ingredients);
        await window.CookbookSync.writeJson(
          "data/ingredients/_index.json",
          ingredients,
          `Atualizar índice de ingredientes após ${name}`
        );

        editingIngredientId = null;
        clearInlineIngredientPicker();
        renderIngredients();
        showStatus(status, "Ingrediente salvo neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
        window.CookbookUI?.nudgeSync?.();
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    list.querySelectorAll("[data-confirm-ingredient]").forEach((btn) => {
      btn.addEventListener("click", () => void confirmIngredient());
    });
    bindInlineEnterConfirm(list, confirmIngredient);

    list.querySelectorAll("[data-delete-ingredient]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = ingredients.find((i) => i.id === btn.dataset.deleteIngredient);
        if (!item) return;
        const status = qs("[data-status]");
        try {
          showStatus(status, "Verificando uso do ingrediente…", "info");
          const refs = await findRecipesUsing({ ingredientId: item.id });
          if (refs.length) {
            showStatus(
              status,
              `Não é possível excluir: usado em ${formatUsageList(refs)}.`,
              "error"
            );
            return;
          }
          if (!window.confirm("Excluir este ingrediente do catálogo?")) return;
          showStatus(status, "Excluindo ingrediente…", "info");
          await window.CookbookSync.remove(
            `data/ingredients/${item.id}.json`,
            `Excluir ingrediente ${item.id}`
          );
          if (item.image && item.image.startsWith("data/images/ingredients/")) {
            await window.CookbookSync.remove(item.image, `Excluir imagem do ingrediente ${item.id}`);
          }
          if (editingIngredientId === item.id) {
            editingIngredientId = null;
            clearInlineIngredientPicker();
          }
          ingredients = window.CookbookData.sortByName(
            ingredients.filter((i) => i.id !== item.id)
          );
          await window.CookbookSync.writeJson(
            "data/ingredients/_index.json",
            ingredients,
            `Atualizar índice de ingredientes após excluir ${item.id}`
          );
          renderIngredients();
          showStatus(status, "Ingrediente excluído neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
          window.CookbookUI?.nudgeSync?.();
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });

    if (editingId) {
      const item = ingredients.find((i) => i.id === editingId);
      if (item) void mountInlineIngredientImage(item);
    }

    void window.CookbookSync.hydrateImages(list);
  }

  async function saveCategories(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando categorias…", "info");
    try {
      categories = window.CookbookData.sortByName(categories);
      await window.CookbookSync.writeJson(
        "data/categories.json",
        categories,
        message || "Atualizar categorias"
      );
      renderCategories();
      showStatus(status, "Categorias salvas neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
      window.CookbookUI?.nudgeSync?.();
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  async function saveMeasures(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando medidas…", "info");
    try {
      measures = window.CookbookData.sortByName(measures);
      await window.CookbookSync.writeJson(
        "data/measures.json",
        measures,
        message || "Atualizar medidas"
      );
      renderMeasures();
      showStatus(status, "Medidas salvas neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
      window.CookbookUI?.nudgeSync?.();
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  function resetCategoryForm() {
    qs("#category-form")?.reset();
  }

  function resetMeasureForm() {
    qs("#measure-form")?.reset();
  }

  function resetIngredientForm() {
    qs("#ingredient-form")?.reset();
    ingredientImageFile = null;
    ingredientImageCleared = false;
    ingredientImagePicker?.setUrl("");
  }

  function decorateFormActionIcons() {
    const add = window.CookbookIcons.add();
    const check = window.CookbookIcons.check();
    const close = window.CookbookIcons.closeSmall();
    document.querySelectorAll("[data-open-add]").forEach((btn) => {
      btn.innerHTML = add;
    });
    document.querySelectorAll('.catalog-add [type="submit"]').forEach((btn) => {
      btn.innerHTML = check;
    });
    document.querySelectorAll("[data-cancel-add]").forEach((btn) => {
      btn.innerHTML = close;
    });
  }

  function bindFormHandlers() {
    if (formHandlersBound) {
      // Rebinding after in-book remount: replace DOM handlers via on* props
    }
    formHandlersBound = true;

    qs("[data-tabs]").onclick = (event) => {
      const btn = event.target.closest("[data-tab]");
      if (btn) setTab(btn.dataset.tab);
    };

    document.querySelectorAll("[data-open-add]").forEach((btn) => {
      btn.onclick = () => openAddPanel(btn.dataset.openAdd);
    });
    document.querySelectorAll("[data-cancel-add]").forEach((btn) => {
      btn.onclick = () => closeAddPanel(btn.dataset.cancelAdd);
    });

    qs("#category-form").onsubmit = async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const name = qs("#category-name").value.trim();
      if (!name) return;
      try {
        const ok = await assertNameAvailable(categories, name, {
          label: "uma categoria",
        });
        if (!ok) return;

        const id = window.CookbookData.uniqueId(
          name,
          new Set(categories.map((c) => c.id))
        );
        categories.push({ id, name });
        await saveCategories(`Adicionar categoria ${id}`);
        closeAddPanel("categories");
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    qs("#measure-form").onsubmit = async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const name = qs("#measure-name").value.trim();
      const abbrev = qs("#measure-abbrev").value.trim();
      if (!name) return;
      try {
        const ok = await assertNameAvailable(measures, name, {
          label: "uma medida",
        });
        if (!ok) return;

        const id = window.CookbookData.uniqueId(
          name,
          new Set(measures.map((m) => m.id))
        );
        measures.push({ id, name, abbrev: abbrev || name });
        await saveMeasures(`Adicionar medida ${id}`);
        closeAddPanel("measures");
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    qs("#ingredient-form").onsubmit = async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const name = qs("#ingredient-name").value.trim();
      if (!name) return;

      try {
        const ok = await assertNameAvailable(ingredients, name, {
          label: "um ingrediente",
        });
        if (!ok) return;

        const existingIds = new Set(ingredients.map((i) => i.id));
        const id = window.CookbookData.uniqueId(name, existingIds);
        if (!id) return;

        const file = ingredientImageFile || ingredientImagePicker?.getFile() || null;
        let imagePath = "";

        showStatus(status, "Salvando ingrediente…", "info");

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

        renderIngredients();
        closeAddPanel("ingredients");
        showStatus(status, "Ingrediente salvo neste dispositivo. Use Sincronizar para enviar ao GitHub.", "ok");
        window.CookbookUI?.nudgeSync?.();
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };
  }

  async function bootEditor({ skipShell = false } = {}) {
    if (skipShell) {
      if (!window.CookbookAuth.isCook()) return;
    } else if (!window.CookbookAuth.requireCookOrRedirect()) {
      return;
    } else {
      window.CookbookUI.mountShell({ active: "manage" });
    }

    [categories, measures, ingredients] = await Promise.all([
      window.CookbookData.loadCategories(),
      window.CookbookData.loadMeasures(),
      window.CookbookData.loadIngredientIndex(),
    ]);

    renderCategories();
    renderMeasures();
    renderIngredients();
    setTab("categories");

    ingredientImagePicker = mountImagePicker(qs("[data-ingredient-image]"), {
      onChange: (file) => {
        ingredientImageFile = file;
        ingredientImageCleared = !file;
      },
    });

    decorateFormActionIcons();
    bindFormHandlers();
  }

  async function mountInBook(_host, { onClose } = {}) {
    inBookMode = true;
    onCloseCb = onClose || null;
    formHandlersBound = false;
    await bootEditor({ skipShell: true });
  }

  function unmountFromBook() {
    inBookMode = false;
    onCloseCb = null;
    formHandlersBound = false;
    ingredientImagePicker = null;
    ingredientImageFile = null;
    ingredientImageCleared = false;
    clearInlineIngredientPicker();
    editingCategoryId = null;
    editingMeasureId = null;
    editingIngredientId = null;
    addingTab = null;
  }

  async function boot() {
    inBookMode = false;
    await bootEditor({ skipShell: false });
  }

  window.CookbookManage = {
    formShellHtml,
    mountInBook,
    unmountFromBook,
  };

  window.addEventListener("cookbook:ready", () => {
    if (document.querySelector("[data-book]")) return;
    boot().catch((err) => showStatus(qs("[data-status]"), err.message, "error"));
  });
  if (!document.querySelector("[data-book]")) {
    window.CookbookAuth.ensureSession();
  }
})();
