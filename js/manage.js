(function () {
  const { qs, showStatus, mountImagePicker } = window.CookbookUI;
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
      btn.addEventListener("click", () => {
        const item = ingredients.find((i) => i.id === btn.dataset.editIngredient);
        editingIngredientId = item.id;
        qs("#ingredient-name").value = item.name;
        qs("#ingredient-form [type='submit']").textContent = "Atualizar ingrediente";
        ingredientSavedImage = item.image || "";
        ingredientImageFile = null;
        ingredientImageCleared = false;
        ingredientImagePicker?.setUrl(ingredientSavedImage);
      });
    });

    list.querySelectorAll("[data-delete-ingredient]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Excluir este ingrediente do catálogo?")) return;
        const token = window.CookbookAuth.getToken();
        const item = ingredients.find((i) => i.id === btn.dataset.deleteIngredient);
        const status = qs("[data-status]");
        showStatus(status, "Excluindo ingrediente…", "info");
        try {
          await window.CookbookGitHub.deleteFile(
            `data/ingredients/${item.id}.json`,
            `Excluir ingrediente ${item.id}`,
            token
          );
          if (item.image && item.image.startsWith("data/images/ingredients/")) {
            await window.CookbookGitHub.deleteFile(item.image, `Excluir imagem do ingrediente ${item.id}`, token);
          }
          ingredients = ingredients.filter((i) => i.id !== item.id);
          await window.CookbookGitHub.putJsonFile(
            "data/ingredients/_index.json",
            ingredients,
            `Atualizar índice de ingredientes após excluir ${item.id}`,
            token
          );
          renderIngredients();
          showStatus(status, "Ingrediente excluído. As páginas podem levar um minuto para atualizar.", "ok");
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });
  }

  async function saveCategories(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando categorias…", "info");
    try {
      await window.CookbookGitHub.putJsonFile(
        "data/categories.json",
        categories,
        message || "Atualizar categorias",
        window.CookbookAuth.getToken()
      );
      renderCategories();
      resetCategoryForm();
      showStatus(status, "Categorias salvas.", "ok");
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  async function saveMeasures(message) {
    const status = qs("[data-status]");
    showStatus(status, "Salvando medidas…", "info");
    try {
      await window.CookbookGitHub.putJsonFile(
        "data/measures.json",
        measures,
        message || "Atualizar medidas",
        window.CookbookAuth.getToken()
      );
      renderMeasures();
      resetMeasureForm();
      showStatus(status, "Medidas salvas.", "ok");
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

  async function boot() {
    if (!window.CookbookAuth.requireCookOrRedirect()) return;
    window.CookbookUI.mountShell({ active: "manage" });

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

    qs("[data-tabs]").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab]");
      if (btn) setTab(btn.dataset.tab);
    });

    qs("#category-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = qs("#category-name").value.trim();
      if (!name) return;
      const id = editingCategoryId || window.CookbookData.slugify(name);
      if (!id) return;
      const existing = categories.find((c) => c.id === id);
      if (existing) existing.name = name;
      else categories.push({ id, name });
      await saveCategories(existing ? `Atualizar categoria ${id}` : `Adicionar categoria ${id}`);
    });

    qs("#measure-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = qs("#measure-name").value.trim();
      const abbrev = qs("#measure-abbrev").value.trim();
      if (!name) return;
      const id = editingMeasureId || window.CookbookData.slugify(name);
      if (!id) return;
      const existing = measures.find((m) => m.id === id);
      if (existing) {
        existing.name = name;
        existing.abbrev = abbrev || name;
      } else {
        measures.push({ id, name, abbrev: abbrev || name });
      }
      await saveMeasures(existing ? `Atualizar medida ${id}` : `Adicionar medida ${id}`);
    });

    qs("#ingredient-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const token = window.CookbookAuth.getToken();
      const name = qs("#ingredient-name").value.trim();
      if (!name) return;

      const existingIds = new Set(ingredients.map((i) => i.id));
      const id = editingIngredientId || window.CookbookData.uniqueId(name, existingIds);
      if (!id) return;

      const file = ingredientImageFile || ingredientImagePicker?.getFile() || null;
      const existing = ingredients.find((i) => i.id === id);
      const previousImagePath = existing?.image || ingredientSavedImage || "";
      let imagePath = ingredientImageCleared ? "" : previousImagePath;

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
          if (
            previousImagePath &&
            previousImagePath !== imagePath &&
            previousImagePath.startsWith("data/images/ingredients/")
          ) {
            await window.CookbookGitHub.deleteFile(
              previousImagePath,
              `Remover imagem anterior do ingrediente ${id}`,
              token
            );
          }
        } else if (
          ingredientImageCleared &&
          previousImagePath.startsWith("data/images/ingredients/")
        ) {
          await window.CookbookGitHub.deleteFile(
            previousImagePath,
            `Remover imagem do ingrediente ${id}`,
            token
          );
        }

        const record = { id, name, image: imagePath };
        await window.CookbookGitHub.putJsonFile(
          `data/ingredients/${id}.json`,
          record,
          `${existing ? "Atualizar" : "Adicionar"} ingrediente: ${name}`,
          token
        );

        if (existing) {
          existing.name = name;
          existing.image = imagePath;
        } else {
          ingredients.push(record);
        }

        await window.CookbookGitHub.putJsonFile(
          "data/ingredients/_index.json",
          ingredients,
          `Atualizar índice de ingredientes após ${name}`,
          token
        );

        renderIngredients();
        resetIngredientForm();
        showStatus(status, "Ingrediente salvo.", "ok");
      } catch (err) {
        showStatus(status, err.message, "error");
      }
    });

    qs("[data-reset-category]").addEventListener("click", resetCategoryForm);
    qs("[data-reset-measure]").addEventListener("click", resetMeasureForm);
    qs("[data-reset-ingredient]").addEventListener("click", resetIngredientForm);
  }

  window.addEventListener("cookbook:ready", () => {
    boot().catch((err) => showStatus(qs("[data-status]"), err.message, "error"));
  });
  window.CookbookAuth.ensureSession();
})();
