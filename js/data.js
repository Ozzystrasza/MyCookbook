(function () {
  async function fetchJson(path) {
    if (window.CookbookAuth?.isCook?.() && window.CookbookSync?.readJson) {
      return window.CookbookSync.readJson(path);
    }
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não foi possível carregar ${path}`);
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

  function normalizeName(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function levenshtein(a, b) {
    const left = String(a);
    const right = String(b);
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    const rows = left.length + 1;
    const cols = right.length + 1;
    const prev = new Array(cols);
    const curr = new Array(cols);
    for (let j = 0; j < cols; j += 1) prev[j] = j;
    for (let i = 1; i < rows; i += 1) {
      curr[0] = i;
      const ca = left.charCodeAt(i - 1);
      for (let j = 1; j < cols; j += 1) {
        const cost = ca === right.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j < cols; j += 1) prev[j] = curr[j];
    }
    return prev[cols - 1];
  }

  function similarDistanceLimit(len) {
    return len <= 8 ? 1 : 2;
  }

  function findExactNameMatch(items, name, { excludeId = null, nameKey = "name" } = {}) {
    const needle = normalizeName(name);
    if (!needle) return null;
    return (
      (items || []).find((item) => {
        if (!item || (excludeId && item.id === excludeId)) return false;
        return normalizeName(item[nameKey]) === needle;
      }) || null
    );
  }

  function findSimilarNameMatches(
    items,
    name,
    { excludeId = null, nameKey = "name", limit = 5 } = {}
  ) {
    const needle = normalizeName(name);
    if (!needle) return [];
    const maxDist = similarDistanceLimit(needle.length);
    const scored = [];
    for (const item of items || []) {
      if (!item || (excludeId && item.id === excludeId)) continue;
      const candidate = normalizeName(item[nameKey]);
      if (!candidate || candidate === needle) continue;
      const distance = levenshtein(needle, candidate);
      if (distance > 0 && distance <= maxDist) {
        scored.push({ item, distance });
      }
    }
    scored.sort((a, b) => a.distance - b.distance || String(a.item[nameKey]).localeCompare(String(b.item[nameKey])));
    return scored.slice(0, limit).map((entry) => entry.item);
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
    normalizeName,
    findExactNameMatch,
    findSimilarNameMatches,
  };
})();
