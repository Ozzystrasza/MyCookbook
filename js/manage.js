(function () {
  const { qs, showStatus } = window.CookbookUI;
  let categories = [];
  let measures = [];
  let ingredients = [];
  let activeTab = "categories";

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
          <span class="hint">${item.id}</span>
          <div class="actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-category="${item.id}">Edit</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-category="${item.id}">Delete</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = categories.find((c) => c.id === btn.dataset.editCategory);
        qs("#category-id").value = item.id;
        qs("#category-id").disabled = true;
        qs("#category-name").value = item.name;
        qs("#category-form [type='submit']").textContent = "Update category";
      });
    });

    list.querySelectorAll("[data-delete-category]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Delete this category?")) return;
        categories = categories.filter((c) => c.id !== btn.dataset.deleteCategory);
        await saveCategories("Delete category");
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
            <button type="button" class="btn btn--ghost btn--small" data-edit-measure="${item.id}">Edit</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-measure="${item.id}">Delete</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-measure]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = measures.find((m) => m.id === btn.dataset.editMeasure);
        qs("#measure-id").value = item.id;
        qs("#measure-id").disabled = true;
        qs("#measure-name").value = item.name;
        qs("#measure-abbrev").value = item.abbrev || "";
        qs("#measure-form [type='submit']").textContent = "Update measure";
      });
    });

    list.querySelectorAll("[data-delete-measure]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Delete this measure?")) return;
        measures = measures.filter((m) => m.id !== btn.dataset.deleteMeasure);
        await saveMeasures("Delete measure");
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
          <span class="hint">${item.id}</span>
          <div class="actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-ingredient="${item.id}">Edit</button>
            <button type="button" class="btn btn--danger btn--small" data-delete-ingredient="${item.id}">Delete</button>
          </div>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-edit-ingredient]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = ingredients.find((i) => i.id === btn.dataset.editIngredient);
        qs("#ingredient-id").value = item.id;
        qs("#ingredient-id").disabled = true;
        qs("#ingredient-name").value = item.name;
        qs("#ingredient-form [type='submit']").textContent = "Update ingredient";
        qs("[data-ingredient-image-hint]").textContent = item.image
          ? `Current image: ${item.image}`
          : "No image yet.";
      });
    });

    list.querySelectorAll("[data-delete-ingredient]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Delete this ingredient from the catalog?")) return;
        const token = window.CookbookAuth.getToken();
        const item = ingredients.find((i) => i.id === btn.dataset.deleteIngredient);
        const status = qs("[data-status]");
        showStatus(status, "Deleting ingredient…", "info");
        try {
          await window.CookbookGitHub.deleteFile(
            `data/ingredients/${item.id}.json`,
            `Delete ingredient ${item.id}`,
            token
          );
          if (item.image && item.image.startsWith("data/images/ingredients/")) {
            await window.CookbookGitHub.deleteFile(item.image, `Delete ingredient image ${item.id}`, token);
          }
          ingredients = ingredients.filter((i) => i.id !== item.id);
          await window.CookbookGitHub.putJsonFile(
            "data/ingredients/_index.json",
            ingredients,
            `Refresh ingredient index after delete ${item.id}`,
            token
          );
          renderIngredients();
          showStatus(status, "Ingredient deleted. Pages may take a minute to update.", "ok");
        } catch (err) {
          showStatus(status, err.message, "error");
        }
      });
    });
  }

  async function saveCategories(message) {
    const status = qs("[data-status]");
    showStatus(status, "Saving categories…", "info");
    try {
      await window.CookbookGitHub.putJsonFile(
        "data/categories.json",
        categories,
        message || "Update categories",
        window.CookbookAuth.getToken()
      );
      renderCategories();
      resetCategoryForm();
      showStatus(status, "Categories saved.", "ok");
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  async function saveMeasures(message) {
    const status = qs("[data-status]");
    showStatus(status, "Saving measures…", "info");
    try {
      await window.CookbookGitHub.putJsonFile(
        "data/measures.json",
        measures,
        message || "Update measures",
        window.CookbookAuth.getToken()
      );
      renderMeasures();
      resetMeasureForm();
      showStatus(status, "Measures saved.", "ok");
    } catch (err) {
      showStatus(status, err.message, "error");
    }
  }

  function resetCategoryForm() {
    qs("#category-form").reset();
    qs("#category-id").disabled = false;
    qs("#category-form [type='submit']").textContent = "Add category";
  }

  function resetMeasureForm() {
    qs("#measure-form").reset();
    qs("#measure-id").disabled = false;
    qs("#measure-form [type='submit']").textContent = "Add measure";
  }

  function resetIngredientForm() {
    qs("#ingredient-form").reset();
    qs("#ingredient-id").disabled = false;
    qs("#ingredient-form [type='submit']").textContent = "Add ingredient";
    qs("[data-ingredient-image-hint]").textContent = "";
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

    qs("[data-tabs]").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab]");
      if (btn) setTab(btn.dataset.tab);
    });

    qs("#category-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const idInput = qs("#category-id");
      const name = qs("#category-name").value.trim();
      const id = idInput.disabled
        ? idInput.value
        : window.CookbookData.slugify(qs("#category-id").value.trim() || name);
      if (!name || !id) return;
      const existing = categories.find((c) => c.id === id);
      if (existing) existing.name = name;
      else categories.push({ id, name });
      await saveCategories(existing ? `Update category ${id}` : `Add category ${id}`);
    });

    qs("#measure-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const idInput = qs("#measure-id");
      const name = qs("#measure-name").value.trim();
      const abbrev = qs("#measure-abbrev").value.trim();
      const id = idInput.disabled
        ? idInput.value
        : window.CookbookData.slugify(qs("#measure-id").value.trim() || name);
      if (!name || !id) return;
      const existing = measures.find((m) => m.id === id);
      if (existing) {
        existing.name = name;
        existing.abbrev = abbrev || name;
      } else {
        measures.push({ id, name, abbrev: abbrev || name });
      }
      await saveMeasures(existing ? `Update measure ${id}` : `Add measure ${id}`);
    });

    qs("#ingredient-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = qs("[data-status]");
      const token = window.CookbookAuth.getToken();
      const idInput = qs("#ingredient-id");
      const name = qs("#ingredient-name").value.trim();
      const existingIds = new Set(ingredients.map((i) => i.id));
      const id = idInput.disabled
        ? idInput.value
        : window.CookbookData.uniqueId(qs("#ingredient-id").value.trim() || name, existingIds);
      if (!name || !id) return;

      const file = qs("#ingredient-image").files?.[0];
      const existing = ingredients.find((i) => i.id === id);
      let imagePath = existing?.image || "";

      showStatus(status, "Saving ingredient…", "info");
      try {
        if (file) {
          const ext = window.CookbookGitHub.extensionForFile(file);
          imagePath = `data/images/ingredients/${id}${ext}`;
          const base64 = await window.CookbookGitHub.fileToBase64(file);
          await window.CookbookGitHub.putFile(
            imagePath,
            base64,
            `Update ingredient image: ${name}`,
            token,
            (await window.CookbookGitHub.getFile(imagePath, token))?.sha
          );
        }

        const record = { id, name, image: imagePath };
        await window.CookbookGitHub.putJsonFile(
          `data/ingredients/${id}.json`,
          record,
          `${existing ? "Update" : "Add"} ingredient: ${name}`,
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
          `Refresh ingredient index after ${name}`,
          token
        );

        renderIngredients();
        resetIngredientForm();
        showStatus(status, "Ingredient saved.", "ok");
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
