(function () {
  const { qs } = window.CookbookUI;
  const params = new URLSearchParams(window.location.search);
  const recipeId = params.get("id");

  async function boot() {
    window.CookbookUI.mountShell({ active: "home" });
    const host = qs("[data-recipe]");
    if (!recipeId) {
      host.innerHTML = `<div class="empty">Missing recipe id.</div>`;
      return;
    }

    try {
      const [recipe, categories, measures, ingredients] = await Promise.all([
        window.CookbookData.loadRecipe(recipeId),
        window.CookbookData.loadCategories(),
        window.CookbookData.loadMeasures(),
        window.CookbookData.loadIngredientIndex(),
      ]);

      const category = categories.find((c) => c.id === recipe.categoryId);
      const measureMap = Object.fromEntries(measures.map((m) => [m.id, m]));
      const ingredientMap = Object.fromEntries(ingredients.map((i) => [i.id, i]));
      const cook = window.CookbookAuth.isCook();

      host.innerHTML = `
        <section class="recipe-hero">
          <img src="${recipe.image || ""}" alt="" />
          <div class="recipe-hero__content">
            <p class="hero__eyebrow">${category?.name || "Recipe"}</p>
            <h1>${recipe.title}</h1>
            ${
              cook
                ? `<p style="margin-top:1rem"><a class="btn btn--ghost" href="edit.html?id=${encodeURIComponent(recipe.id)}" data-cook-only>Edit recipe</a></p>`
                : ""
            }
          </div>
        </section>
        <div data-groups></div>
      `;

      const groupsHost = qs("[data-groups]", host);
      groupsHost.innerHTML = (recipe.groups || [])
        .map((group, index) => {
          const ingredientItems = (group.ingredients || [])
            .map((line) => {
              const ingredient = ingredientMap[line.ingredientId];
              const measure = measureMap[line.measureId];
              return `
                <li class="ingredient-item">
                  <img src="${ingredient?.image || ""}" alt="" />
                  <div>
                    <strong>${ingredient?.name || line.ingredientId}</strong>
                  </div>
                  <span>${window.CookbookData.formatQuantity(line.quantity, measure)}</span>
                </li>`;
            })
            .join("");

          const steps = (group.steps || [])
            .map((step) => `<li>${step.description}</li>`)
            .join("");

          return `
            <section class="group" style="animation-delay:${index * 0.06}s">
              <h2>${group.name || "Section"}</h2>
              <div class="group__columns">
                <div>
                  <h3>Ingredients</h3>
                  <ul class="ingredient-list">${ingredientItems || "<li>None listed.</li>"}</ul>
                </div>
                <div>
                  <h3>Steps</h3>
                  <ol class="step-list">${steps || "<li>No steps yet.</li>"}</ol>
                </div>
              </div>
            </section>`;
        })
        .join("");

      window.CookbookAuth.applyCookUi(host);
    } catch (err) {
      host.innerHTML = `<div class="empty">${err.message}</div>`;
    }
  }

  window.addEventListener("cookbook:ready", boot);
  window.CookbookAuth.ensureSession();
})();
