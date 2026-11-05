(function () {
  const { qs } = window.CookbookUI;

  async function boot() {
    if (window.CookbookAuth.wantsOpenedEntry()) {
      document.body.classList.remove("is-gated");
    }
    window.CookbookUI.mountShell({ active: "home" });
    const stage = qs(".book__stage");
    const left = qs('[data-page="left"]');
    const right = qs('[data-page="right"]');
    const escape = window.CookbookUI.escapeHtml || ((v) => String(v ?? ""));
    stage?.setAttribute("aria-busy", "true");
    if (left) {
      left.innerHTML = `<div class="empty" role="status" aria-live="polite">Carregando receitas…</div>`;
    }
    if (right) right.innerHTML = "";
    try {
      const [categories, recipes] = await Promise.all([
        window.CookbookData.loadCategories(),
        window.CookbookData.loadRecipeIndex(),
      ]);
      await window.CookbookBook.start({ recipes, categories });
    } catch (err) {
      if (left) left.innerHTML = `<div class="empty">${escape(err.message)}</div>`;
    } finally {
      stage?.removeAttribute("aria-busy");
    }
  }

  window.addEventListener("cookbook:ready", boot);
  window.CookbookAuth.ensureSession();
})();
