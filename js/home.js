(function () {
  const { qs } = window.CookbookUI;
  let recipes = [];
  let categories = [];
  let activeCategory = "all";

  function categoryName(id) {
    return categories.find((c) => c.id === id)?.name || id || "Uncategorized";
  }

  function renderFilters() {
    const host = qs("[data-filters]");
    if (!host) return;
    const items = [{ id: "all", name: "All" }, ...categories];
    host.innerHTML = items
      .map(
        (item) => `
      <button type="button" class="chip ${activeCategory === item.id ? "is-active" : ""}" data-filter="${item.id}">
        ${item.name}
      </button>`
      )
      .join("");

    host.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategory = btn.getAttribute("data-filter");
        renderFilters();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    const host = qs("[data-recipe-grid]");
    if (!host) return;
    const filtered =
      activeCategory === "all"
        ? recipes
        : recipes.filter((r) => r.categoryId === activeCategory);

    if (!filtered.length) {
      host.innerHTML = `<div class="empty">No recipes in this category yet.</div>`;
      return;
    }

    host.innerHTML = filtered
      .map(
        (recipe, index) => `
      <a class="recipe-card" href="recipe.html?id=${encodeURIComponent(recipe.id)}" style="animation-delay:${index * 0.05}s">
        <img class="recipe-card__media" src="${recipe.image || ""}" alt="" />
        <div class="recipe-card__body">
          <p class="recipe-card__category">${categoryName(recipe.categoryId)}</p>
          <h2 class="recipe-card__title">${recipe.title}</h2>
        </div>
      </a>`
      )
      .join("");
  }

  async function boot() {
    window.CookbookUI.mountShell({ active: "home" });
    try {
      [categories, recipes] = await Promise.all([
        window.CookbookData.loadCategories(),
        window.CookbookData.loadRecipeIndex(),
      ]);
      renderFilters();
      renderGrid();
    } catch (err) {
      qs("[data-recipe-grid]").innerHTML = `<div class="empty">${err.message}</div>`;
    }
  }

  window.addEventListener("cookbook:ready", boot);
  window.CookbookAuth.ensureSession();
})();
