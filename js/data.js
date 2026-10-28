(function () {
  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load ${path}`);
    return res.json();
  }

  async function loadCategories() {
    return fetchJson("data/categories.json");
  }

  async function loadMeasures() {
    return fetchJson("data/measures.json");
  }

  async function loadIngredientIndex() {
    return fetchJson("data/ingredients/_index.json");
  }

  async function loadIngredient(id) {
    return fetchJson(`data/ingredients/${id}.json`);
  }

  async function loadRecipeIndex() {
    return fetchJson("data/recipes/_index.json");
  }

  async function loadRecipe(id) {
    return fetchJson(`data/recipes/${id}.json`);
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `item-${Date.now()}`;
  }

  function uniqueId(base, existingIds) {
    let id = slugify(base);
    let n = 2;
    while (existingIds.has(id)) {
      id = `${slugify(base)}-${n}`;
      n += 1;
    }
    return id;
  }

  function formatQuantity(quantity, measure) {
    const q = quantity === null || quantity === undefined || quantity === "" ? "" : String(quantity);
    if (!measure) return q;
    if (measure.id === "to-taste") return measure.name;
    const unit = measure.abbrev || measure.name || "";
    return q ? `${q} ${unit}` : unit;
  }

  window.CookbookData = {
    fetchJson,
    loadCategories,
    loadMeasures,
    loadIngredientIndex,
    loadIngredient,
    loadRecipeIndex,
    loadRecipe,
    slugify,
    uniqueId,
    formatQuantity,
  };
})();
