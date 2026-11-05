(function () {
  const { qs, showStatus, mountImagePicker, assertNameAvailable } = window.CookbookUI;
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
  let ingredientSavedImage = "";
  let inBookMode = false;
  let onCloseCb = null;
  let formHandlersBound = false;

  function formShellHtml() {
    return `
      <div class="book-form panel panel--in-book">
        <h1>Gerenciar catálogos</h1>
        <p class="hint">Categorias, medidas e ingredientes reutilizáveis com fotos.</p>
        <p class="status" data-status hidden></p>
        <div class="tabs" data-tabs>
          <button type="button" class="btn btn--ghost is-active" data-tab="categories">Categorias</button>
          <button type="button" class="btn btn--ghost" data-tab="measures">Medidas</button>
          <button type="button" class="btn btn--ghost" data-tab="ingredients">Ingredientes</button>
        </div>
        <div data-panel-categories>
          <form id="category-form" class="stack">
            <label class="field">
              <span>Nome</span>
              <input id="category-name" required placeholder="Sobremesas" />
            </label>
            <div class="actions">
              <button type="submit" class="btn btn--primary">Adicionar categoria</button>
              <button type="button" class="btn btn--ghost" data-reset-category>Limpar</button>
            </div>
          </form>
          <div class="catalog-grid" data-category-list style="margin-top:1rem"></div>
        </div>
        <div data-panel-measures hidden>
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
            <div class="actions">
              <button type="submit" class="btn btn--primary">Adicionar medida</button>
              <button type="button" class="btn btn--ghost" data-reset-measure>Limpar</button>
            </div>
          </form>
          <div class="catalog-grid" data-measure-list style="margin-top:1rem"></div>
        </div>
        <div data-panel-ingredients hidden>
          <form id="ingredient-form" class="stack">
            <label class="field">
              <span>Nome</span>
              <input id="ingredient-name" required placeholder="Farinha de trigo" />
            </label>
            <div class="field">
              <span>Foto</span>
              <div data-ingredient-image></div>
            </div>
            <div class="actions">
              <button type="submit" class="btn btn--primary">Adicionar ingrediente</button>
              <button type="button" class="btn btn--ghost" data-reset-ingredient>Limpar</button>
            </div>
          </form>
          <div class="catalog-grid" data-ingredient-list style="margin-top:1rem"></div>
        </div>
      </div>
    `;
  }

  function setTab(tab) {
    activeTab = tab;
    qs("[data-tabs]").querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
    qs("[data-panel-categories]").hidden = tab !== "categories";
    qs("[data-panel-measures]").hidden = tab !== "measures";
    qs("[data-panel-ingredients]").hidden = tab !== "ingredients";
  }

  function renderCategories() {
    const list = qs("[data-category-list]");
    list.innerHTML = categories
      .map(
        (item) => `
      <div class="catalog-card">
        <div class="catalog-card__body">
          <strong>${item.name}</strong>
          <div class="actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-category="${item.id}">Editar</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-category="${item.id}">Excluir</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = categories.find((c) => c.id === btn.dataset.editCategory);
        editingCategoryId = item.id;
        qs("#category-name").value = item.name;
        qs("#category-form [type='submit']").textContent = "Atualizar categoria";
      });
    });

    list.querySelectorAll("[data-delete-category]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Excluir esta categoria?")) return;
        categories = categories.filter((c) => c.id !== btn.dataset.deleteCategory);
        await saveCategories("Excluir categoria");
      });
    });
  }

  function renderMeasures() {
    const list = qs("[data-measure-list]");
    list.innerHTML = measures
      .map(
        (item) => `
      <div class="catalog-card">
        <div class="catalog-card__body">
          <strong>${item.name}</strong>
          <span class="hint">${item.abbrev || item.id}</span>
          <div class="actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-measure="${item.id}">Editar</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-measure="${item.id}">Excluir</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-measure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = measures.find((m) => m.id === btn.dataset.editMeasure);
        editingMeasureId = item.id;
        qs("#measure-name").value = item.name;
        qs("#measure-abbrev").value = item.abbrev || "";
        qs("#measure-form [type='submit']").textContent = "Atualizar medida";
      });
    });

    list.querySelectorAll("[data-delete-measure]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Excluir esta medida?")) return;
        measures = measures.filter((m) => m.id !== btn.dataset.deleteMeasure);
        await saveMeasures("Excluir medida");
      });
    });
  }

  function renderIngredients() {
    const list = qs("[data-ingredient-list]");
    list.innerHTML = ingredients
      .map(
        (item) => `
      <div class="catalog-card">
        <img src="${item.image || ""}" alt="" />
        <div class="catalog-card__body">
          <strong>${item.name}</strong>
          <div class="actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-ingredient="${item.id}">Editar</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-ingredient="${item.id}">Excluir</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-ingredient]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = ingredients.find((i) => i.id === btn.dataset.editIngredient);
        editingIngredientId = item.id;
        qs("#ingredient-name").value = item.name;
        qs("#ingredient-form [type='submit']").textContent = "Atualizar ingrediente";
        ingredientSavedImage = item.image || "";
        ingredientImageFile = null;
        ingredientImageCleared = false;
        const preview = ingredientSavedImage
          ? await window.CookbookSync.objectUrl(ingredientSavedImage)
          : "";
        ingredientImagePicker?.setUrl(preview);
      });
    });

    list.querySelectorAll("[data-delete-ingredient]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Excluir este ingrediente do catálogo?")) return;
        const item = ingredients.find((i) => i.id === btn.dataset.deleteIngredient);
        const status = qs("[data-status]");
        showStatus(status, "Excluindo ingrediente…", "info");
        try {
          await window.CookbookSync.remove(
            `data/ingredients/${item.id}.json`,
            `Excluir ingrediente ${item.id}`
          );
          if (item.image && item.image.startsWith("data/images/ingredients/")) {
            await window.CookbookSync.remove(item.image, `Excluir imagem do ingrediente ${item.id}`);
          }
          ingredients = ingredients.filter((i) => i.id !== item.id);
          await window.CookbookSync.writeJson(
            "data/ingredients/_index.json",
            ingredients,
            `Atualizar índice de ingredientes após excluir ${item.id}`
          );
          renderIngredients();
          showStatus(status, "Ingrediente excluído neste dispositivo.", "ok");
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });

    void window.CookbookSync.hydrateImages(list);
  }

  async function saveCategories(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando categorias…", "info");
    try {
      await window.CookbookSync.writeJson(
        "data/categories.json",
        categories,
        message || "Atualizar categorias"
      );
      renderCategories();
      resetCategoryForm();
      showStatus(status, "Categorias salvas neste dispositivo.", "ok");
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  async function saveMeasures(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando medidas…", "info");
    try {
      await window.CookbookSync.writeJson(
        "data/measures.json",
        measures,
        message || "Atualizar medidas"
      );
      renderMeasures();
      resetMeasureForm();
      showStatus(status, "Medidas salvas neste dispositivo.", "ok");
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  function resetCategoryForm() {
    qs("#category-form").reset();
    editingCategoryId = null;
    qs("#category-form [type='submit']").textContent = "Adicionar categoria";
  }

  function resetMeasureForm() {
    qs("#measure-form").reset();
    editingMeasureId = null;
    qs("#measure-form [type='submit']").textContent = "Adicionar medida";
  }

  function resetIngredientForm() {
    qs("#ingredient-form").reset();
    editingIngredientId = null;
    qs("#ingredient-form [type='submit']").textContent = "Adicionar ingrediente";
    ingredientSavedImage = "";
    ingredientImageFile = null;
    ingredientImageCleared = false;
    ingredientImagePicker?.setUrl("");
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

    qs("#category-form").onsubmit = async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const name = qs("#category-name").value.trim();
      if (!name) return;
      try {
        const ok = await assertNameAvailable(categories, name, {
          excludeId: editingCategoryId,
          label: "uma categoria",
        });
        if (!ok) return;

        if (editingCategoryId) {
          const existing = categories.find((c) => c.id === editingCategoryId);
          if (!existing) return;
          existing.name = name;
          await saveCategories(`Atualizar categoria ${editingCategoryId}`);
          return;
        }

        const id = window.CookbookData.uniqueId(
          name,
          new Set(categories.map((c) => c.id))
        );
        categories.push({ id, name });
        await saveCategories(`Adicionar categoria ${id}`);
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
          excludeId: editingMeasureId,
          label: "uma medida",
        });
        if (!ok) return;

        if (editingMeasureId) {
          const existing = measures.find((m) => m.id === editingMeasureId);
          if (!existing) return;
          existing.name = name;
          existing.abbrev = abbrev || name;
          await saveMeasures(`Atualizar medida ${editingMeasureId}`);
          return;
        }

        const id = window.CookbookData.uniqueId(
          name,
          new Set(measures.map((m) => m.id))
        );
        measures.push({ id, name, abbrev: abbrev || name });
        await saveMeasures(`Adicionar medida ${id}`);
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
          excludeId: editingIngredientId,
          label: "um ingrediente",
        });
        if (!ok) return;

        const existingIds = new Set(ingredients.map((i) => i.id));
        const id = editingIngredientId || window.CookbookData.uniqueId(name, existingIds);
        if (!id) return;

        const file = ingredientImageFile || ingredientImagePicker?.getFile() || null;
        const existing = editingIngredientId
          ? ingredients.find((i) => i.id === editingIngredientId)
          : null;
        const previousImagePath = existing?.image || ingredientSavedImage || "";
        let imagePath = ingredientImageCleared ? "" : previousImagePath;

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
          ingredientImageCleared &&
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
          `${existing ? "Atualizar" : "Adicionar"} ingrediente: ${name}`
        );

        if (existing) {
          existing.name = name;
          existing.image = imagePath;
        } else {
          ingredients.push(record);
        }

        await window.CookbookSync.writeJson(
          "data/ingredients/_index.json",
          ingredients,
          `Atualizar índice de ingredientes após ${name}`
        );

        renderIngredients();
        resetIngredientForm();
        showStatus(status, "Ingrediente salvo neste dispositivo.", "ok");
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    };

    qs("[data-reset-category]").onclick = resetCategoryForm;
    qs("[data-reset-measure]").onclick = resetMeasureForm;
    qs("[data-reset-ingredient]").onclick = resetIngredientForm;
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
    ingredientSavedImage = "";
    editingCategoryId = null;
    editingMeasureId = null;
    editingIngredientId = null;
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
