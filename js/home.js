(function () {
  const { qs } = window.CookbookUI;

  async function boot() {
    window.CookbookUI.mountShell({ active: "home" });
    try {
      const [categories, recipes] = await Promise.all([
        window.CookbookData.loadCategories(),
        window.CookbookData.loadRecipeIndex(),
      ]);
      await window.CookbookBook.start({ recipes, categories });
    } catch (err) {
      const left = qs('[data-page="left"]');
      if (left) left.innerHTML = `<div class="empty">${err.message}</div>`;
    }
  }

  window.addEventListener("cookbook:ready", boot);
  window.CookbookAuth.ensureSession();
})();
