(function () {
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function thumbHtml(src, className) {
    const url = String(src || "").trim();
    const cls = escapeHtml(className);
    if (!url) return `<span class="${cls}" aria-hidden="true"></span>`;
    return `<img class="${cls}" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" />`;
  }

  const FOCUSABLE_SEL =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const modalFocusState = new WeakMap();

  function getFocusable(container) {
    if (!container) return [];
    return [...container.querySelectorAll(FOCUSABLE_SEL)].filter((node) => {
      if (node.hasAttribute("disabled") || node.getAttribute("aria-hidden") === "true") return false;
      if (node.closest("[hidden]")) return false;
      return true;
    });
  }

  function activateModalFocus(modal, focusSelector) {
    if (!modal) return;
    deactivateModalFocus(modal, false);
    const panel = modal.querySelector('[role="dialog"]') || modal;
    const prev = document.activeElement;
    function onKeyDown(event) {
      if (event.key !== "Tab") return;
      const list = getFocusable(panel);
      if (!list.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    modal.addEventListener("keydown", onKeyDown);
    modalFocusState.set(modal, { prev, onKeyDown });
    const focusEl =
      (focusSelector && modal.querySelector(focusSelector)) || getFocusable(panel)[0] || panel;
    window.setTimeout(() => focusEl?.focus?.(), 30);
  }

  function deactivateModalFocus(modal, restore = true) {
    const state = modalFocusState.get(modal);
    if (!state) return;
    modal.removeEventListener("keydown", state.onKeyDown);
    modalFocusState.delete(modal);
    if (
      restore &&
      state.prev &&
      typeof state.prev.focus === "function" &&
      document.contains(state.prev)
    ) {
      state.prev.focus();
    }
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, value);
    });
    children.flat().forEach((child) => {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function syncPageChrome(standalone, active) {
    let bar = qs("[data-page-chrome]");
    if (!standalone) {
      document.body.classList.remove("is-standalone-form");
      if (bar) bar.remove();
      return;
    }

    document.body.classList.add("is-standalone-form");
    const header = qs("[data-site-header]");
    if (!header) return;

    if (!bar) {
      bar = document.createElement("div");
      bar.className = "page-chrome";
      bar.setAttribute("data-page-chrome", "");
      header.after(bar);
    }

    const editActions =
      active === "edit"
        ? `<div class="page-chrome__actions">
            <button type="submit" form="recipe-form" class="icon-btn icon-btn--primary" data-recipe-save aria-label="Salvar receita" title="Salvar receita"></button>
            <button type="button" class="icon-btn icon-btn--danger" data-delete hidden aria-label="Excluir receita" title="Excluir receita"></button>
          </div>`
        : "";

    bar.innerHTML = `
      <a href="index.html?home=1" class="icon-btn" aria-label="Voltar">
        ${window.CookbookIcons.chevronLeft()}
      </a>
      ${editActions}
    `;
  }

  function closeOpenNavMenu({ restoreFocus = false } = {}) {
    const menu = qs("[data-nav-menu].is-open");
    if (!menu) return;
    const nav = menu.closest(".site-nav");
    const toggle = nav?.querySelector("[data-nav-menu-toggle]");
    menu.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    if (restoreFocus) toggle?.focus();
  }

  function syncNavMenuAria(menu, toggle) {
    if (!menu || !toggle) return;
    if (window.matchMedia("(min-width: 800px)").matches) {
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      menu.removeAttribute("aria-hidden");
      return;
    }
    const open = menu.classList.contains("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    menu.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function bindNavMenu(header) {
    const toggle = header.querySelector("[data-nav-menu-toggle]");
    const menu = header.querySelector("[data-nav-menu]");
    if (!toggle || !menu) return;

    syncNavMenuAria(menu, toggle);

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.matchMedia("(min-width: 800px)").matches) return;
      const open = !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      syncNavMenuAria(menu, toggle);
      if (open) getFocusable(menu)[0]?.focus();
      else toggle.focus();
    });

    menu.addEventListener("click", (event) => {
      if (!event.target.closest(".site-nav__item")) return;
      closeOpenNavMenu();
    });
  }

  if (!window.__cookbookNavMenuDocBound) {
    window.__cookbookNavMenuDocBound = true;
    document.addEventListener("pointerdown", (event) => {
      const menu = qs("[data-nav-menu].is-open");
      if (!menu) return;
      const nav = menu.closest(".site-nav");
      if (nav?.contains(event.target)) return;
      closeOpenNavMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeOpenNavMenu({ restoreFocus: true });
    });
    window.matchMedia("(min-width: 800px)").addEventListener("change", () => {
      qsa("[data-nav-menu]").forEach((menu) => {
        const toggle = menu.closest(".site-nav")?.querySelector("[data-nav-menu-toggle]");
        syncNavMenuAria(menu, toggle);
      });
    });
  }

  function mountShell({ active } = {}) {
    const header = qs("[data-site-header]");
    if (!header) return;

    const cook = window.CookbookAuth.isCook();
    const standalone = active === "edit" || active === "manage";

    header.innerHTML = `
      <div class="site-header__inner">
        <div class="site-header__brand-row">
          <a class="brand" href="index.html?home=1">My Cookbook</a>
        </div>
        <nav class="site-nav" aria-label="Principal">
          <button type="button" class="icon-btn" data-shopping-toggle title="Lista de compras" aria-label="Lista de compras">
            ${window.CookbookIcons.shoppingCart()}
          </button>
          <button type="button" class="icon-btn site-nav__menu-toggle" data-nav-menu-toggle title="Menu" aria-label="Menu" aria-expanded="false" aria-controls="site-nav-menu">
            ${window.CookbookIcons.menu()}
          </button>
          <div class="site-nav__menu" id="site-nav-menu" data-nav-menu aria-label="Ações">
            ${cook ? `<a href="edit.html" class="site-nav__item${active === "edit" ? " is-active" : ""}" data-cook-only title="Nova receita">
              ${window.CookbookIcons.add()}
              <span class="site-nav__label">Nova receita</span>
            </a>` : ""}
            ${cook ? `<a href="manage.html" class="site-nav__item${active === "manage" ? " is-active" : ""}" data-cook-only title="Gerenciar">
              ${window.CookbookIcons.tune()}
              <span class="site-nav__label">Gerenciar</span>
            </a>` : ""}
            ${cook ? `<button type="button" class="site-nav__item" data-sync-pending hidden title="Sincronizar com GitHub">
              ${window.CookbookIcons.sync()}
              <span class="site-nav__label">Sincronizar</span>
            </button>` : ""}
            <button type="button" class="site-nav__item" data-sign-out title="${cook ? "Sair" : "Trocar perfil"}">
              ${cook ? window.CookbookIcons.logout() : window.CookbookIcons.person()}
              <span class="site-nav__label">${cook ? "Sair" : "Trocar perfil"}</span>
            </button>
          </div>
        </nav>
      </div>
    `;

    syncPageChrome(standalone, active);

    window.CookbookShopping?.bindHeaderToggle(header);
    window.CookbookAuth.applyCookUi(document);
    bindSyncButton(header);
    void refreshSyncButton(header);
    bindNavMenu(header);

    if (!window.matchMedia("(min-width: 800px)").matches) {
      header
        .querySelectorAll('a[href="edit.html"], a[href^="edit.html?"], a[href="edit"], a[href^="edit?"]')
        .forEach((link) => {
          link.addEventListener("click", (event) => {
            if (!window.CookbookBook?.openEdit) return;
            event.preventDefault();
            event.stopPropagation();
            let id = null;
            let from = null;
            try {
              const params = new URL(link.getAttribute("href"), window.location.href).searchParams;
              id = params.get("id");
              from = params.get("from");
            } catch (_) {
              /* ignore */
            }
            void window.CookbookBook.openEdit({ id, from, animate: true });
          });
        });
      header.querySelectorAll('a[href="manage.html"]').forEach((link) => {
        link.addEventListener("click", (event) => {
          if (!window.CookbookBook?.openManage) return;
          event.preventDefault();
          event.stopPropagation();
          void window.CookbookBook.openManage({ animate: true });
        });
      });
    }
  }

  if (!window.__cookbookBrandHomeBound) {
    window.__cookbookBrandHomeBound = true;
    document.addEventListener(
      "click",
      (e) => {
        const brand = e.target.closest("a.brand");
        if (!brand) return;
        if (!window.CookbookBook?.goHome) return;
        if (window.CookbookBook.goHome()) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
  }

  if (!window.__cookbookOpenedEntryBound) {
    window.__cookbookOpenedEntryBound = true;
    document.addEventListener(
      "click",
      (e) => {
        if (document.querySelector("[data-book]")) return;
        const link = e.target.closest("a[href]");
        if (!link) return;
        let url;
        try {
          url = new URL(link.getAttribute("href"), window.location.href);
        } catch {
          return;
        }
        const path = url.pathname.replace(/\\/g, "/");
        const isIndex =
          path.endsWith("/index.html") ||
          path.endsWith("index.html") ||
          path.endsWith("/") ||
          /\/MyCookbook\/?$/i.test(path);
        if (!isIndex) return;
        if (url.origin !== window.location.origin) return;
        window.CookbookAuth.markOpenedEntry({
          shopping: url.searchParams.get("shopping") === "1",
        });
      },
      true
    );
  }

  if (!window.__cookbookSignOutBound) {
    window.__cookbookSignOutBound = true;
    document.addEventListener(
      "pointerup",
      (e) => {
        const btn = e.target.closest("[data-sign-out]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (window.CookbookBook?.closeToCover) {
          window.CookbookBook.closeToCover();
          return;
        }
        window.CookbookAuth.signOut();
        window.location.href = "index.html";
      },
      true
    );
  }

  function showStatus(elNode, message, kind = "info") {
    if (!elNode) return;
    elNode.hidden = !message;
    elNode.textContent = message || "";
    elNode.className = `status status--${kind}`;
    elNode.setAttribute("role", "status");
    elNode.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  }

  async function refreshSyncButton(root = document) {
    const btn = root.querySelector?.("[data-sync-pending]") || qs("[data-sync-pending]");
    if (!btn || !window.CookbookAuth?.isCook?.()) {
      if (btn) btn.hidden = true;
      return;
    }
    const syncing = window.CookbookSync?.isSyncing?.() || false;
    const pending = syncing ? true : await window.CookbookSync.hasPending();
    btn.hidden = !pending;
    btn.disabled = syncing;
    const label = syncing ? "Sincronizando…" : "Sincronizar com GitHub";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.classList.toggle("is-syncing", syncing);
  }

  function bindSyncButton(header) {
    const btn = header?.querySelector?.("[data-sync-pending]");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      if (!window.CookbookSync || btn.disabled) return;
      btn.disabled = true;
      btn.title = "Sincronizando…";
      btn.setAttribute("aria-label", "Sincronizando…");
      btn.classList.add("is-syncing");
      try {
        const result = await window.CookbookSync.syncNow({
          resolveConflict: (detail) => confirmSyncConflict(detail),
        });
        if (result?.discarded) {
          window.location.reload();
          return;
        }
      } catch (err) {
        const message = err?.message || "Falha ao sincronizar.";
        btn.title = message;
        btn.setAttribute("aria-label", message);
        window.alert(message);
      } finally {
        await refreshSyncButton(document);
      }
    });
  }

  if (!window.__cookbookSyncStatusBound) {
    window.__cookbookSyncStatusBound = true;
    window.addEventListener("cookbook:sync-status", () => {
      void refreshSyncButton(document);
    });
  }

  function confirmSimilarNames({ name, matches, label = "item", nameKey = "name" } = {}) {
    const items = Array.isArray(matches) ? matches : [];
    if (!items.length) return Promise.resolve(true);

    return new Promise((resolve) => {
      const existing = document.querySelector("[data-similar-confirm]");
      existing?.remove();

      const modal = document.createElement("div");
      modal.className = "shopping-modal";
      modal.setAttribute("data-similar-confirm", "");
      modal.innerHTML = `
        <div class="shopping-modal__backdrop" data-similar-cancel tabindex="-1"></div>
        <div class="shopping-modal__panel" role="dialog" aria-labelledby="similar-confirm-title" aria-modal="true">
          <div class="shopping-modal__header">
            <h2 class="shopping-modal__title" id="similar-confirm-title">Nome parecido</h2>
            <button type="button" class="icon-btn" data-similar-cancel aria-label="Fechar">
              ${window.CookbookIcons.closeSmall()}
            </button>
          </div>
          <div class="editor-modal__body">
            <p class="hint" data-similar-hint></p>
            <ul class="similar-confirm__list" data-similar-list></ul>
            <div class="editor-modal__footer">
              <button type="button" class="btn btn--ghost" data-similar-cancel>Cancelar</button>
              <button type="button" class="btn btn--primary" data-similar-confirm>Adicionar mesmo assim</button>
            </div>
          </div>
        </div>
      `;

      const hint = modal.querySelector("[data-similar-hint]");
      hint.textContent = `Encontramos ${label} com nome parecido com “${name}”. Confira antes de continuar:`;

      const list = modal.querySelector("[data-similar-list]");
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = String(item?.[nameKey] ?? "");
        list.append(li);
      });

      let settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        deactivateModalFocus(modal);
        modal.remove();
        resolve(ok);
      }

      modal.querySelectorAll("[data-similar-cancel]").forEach((elNode) => {
        elNode.addEventListener("click", () => finish(false));
      });
      modal.querySelector("[data-similar-confirm]")?.addEventListener("click", () => finish(true));
      document.body.appendChild(modal);
      activateModalFocus(modal, "[data-similar-confirm]");
    });
  }

  function confirmSyncConflict() {
    return new Promise((resolve) => {
      const existing = document.querySelector("[data-sync-conflict]");
      existing?.remove();

      const modal = document.createElement("div");
      modal.className = "shopping-modal";
      modal.setAttribute("data-sync-conflict", "");
      modal.innerHTML = `
        <div class="shopping-modal__backdrop" data-sync-conflict-cancel tabindex="-1"></div>
        <div class="shopping-modal__panel" role="dialog" aria-labelledby="sync-conflict-title" aria-modal="true">
          <div class="shopping-modal__header">
            <h2 class="shopping-modal__title" id="sync-conflict-title">Conflito ao sincronizar</h2>
            <button type="button" class="icon-btn" data-sync-conflict-cancel aria-label="Fechar">
              ${window.CookbookIcons.closeSmall()}
            </button>
          </div>
          <div class="editor-modal__body">
            <p class="hint">O GitHub tem alterações mais novas. Descartar as daqui ou sobrescrever o GitHub?</p>
            <div class="editor-modal__footer">
              <button type="button" class="btn btn--ghost" data-sync-conflict-cancel>Cancelar</button>
              <button type="button" class="btn btn--ghost" data-sync-conflict-remote>Descartar locais</button>
              <button type="button" class="btn btn--primary" data-sync-conflict-local>Sobrescrever GitHub</button>
            </div>
          </div>
        </div>
      `;

      let settled = false;
      function finish(choice) {
        if (settled) return;
        settled = true;
        deactivateModalFocus(modal);
        modal.remove();
        resolve(choice);
      }

      modal.querySelectorAll("[data-sync-conflict-cancel]").forEach((elNode) => {
        elNode.addEventListener("click", () => finish(null));
      });
      modal.querySelector("[data-sync-conflict-remote]")?.addEventListener("click", () => finish("remote"));
      modal.querySelector("[data-sync-conflict-local]")?.addEventListener("click", () => finish("local"));
      document.body.appendChild(modal);
      activateModalFocus(modal, "[data-sync-conflict-local]");
    });
  }

  async function assertNameAvailable(items, name, { excludeId = null, nameKey = "name", label = "um item" } = {}) {
    const exact = window.CookbookData.findExactNameMatch(items, name, { excludeId, nameKey });
    if (exact) {
      throw new Error(`Já existe ${label} com esse nome.`);
    }
    const similar = window.CookbookData.findSimilarNameMatches(items, name, { excludeId, nameKey });
    if (!similar.length) return true;
    return confirmSimilarNames({ name, matches: similar, label, nameKey });
  }

  function mountImagePicker(container, { initialUrl = "", onChange } = {}) {
    if (!container) return null;

    let objectUrl = null;
    let currentFile = null;
    let dragDepth = 0;

    container.innerHTML = `
      <div class="image-drop" data-image-drop tabindex="0" role="button" aria-label="Toque ou arraste uma foto">
        <input type="file" accept="image/*" hidden data-image-input />
        <div class="image-drop__preview" data-image-preview hidden>
          <img class="image-drop__img" data-image-thumb alt="" />
          <button type="button" class="icon-btn image-drop__remove" data-image-remove aria-label="Remover imagem" title="Remover">${window.CookbookIcons.remove()}</button>
        </div>
        <div class="image-drop__empty" data-image-empty>Toque ou arraste uma foto</div>
      </div>
    `;

    const root = container.querySelector("[data-image-drop]");
    const input = container.querySelector("[data-image-input]");
    const empty = container.querySelector("[data-image-empty]");
    const preview = container.querySelector("[data-image-preview]");
    const thumb = container.querySelector("[data-image-thumb]");
    const removeBtn = container.querySelector("[data-image-remove]");

    function revokeObjectUrl() {
      if (!objectUrl) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    function showEmpty() {
      preview.hidden = true;
      thumb.removeAttribute("src");
      root.classList.remove("has-image");
    }

    function showPreview(url) {
      preview.hidden = false;
      thumb.src = url;
      root.classList.add("has-image");
    }

    function setFile(file) {
      if (!file || !String(file.type || "").startsWith("image/")) return;
      revokeObjectUrl();
      currentFile = file;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      objectUrl = URL.createObjectURL(file);
      showPreview(objectUrl);
      onChange?.(file);
    }

    function clear() {
      revokeObjectUrl();
      currentFile = null;
      input.value = "";
      showEmpty();
      onChange?.(null);
    }

    function setUrl(url) {
      revokeObjectUrl();
      currentFile = null;
      input.value = "";
      if (url) showPreview(url);
      else showEmpty();
    }

    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-image-remove]")) return;
      input.click();
    });

    removeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clear();
    });

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) setFile(file);
    });

    root.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      root.classList.add("is-dragover");
    });

    root.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });

    root.addEventListener("dragleave", (event) => {
      event.preventDefault();
      dragDepth -= 1;
      if (dragDepth > 0) return;
      dragDepth = 0;
      root.classList.remove("is-dragover");
    });

    root.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      root.classList.remove("is-dragover");
      const file = [...(event.dataTransfer?.files || [])].find((item) =>
        String(item.type || "").startsWith("image/")
      );
      if (file) setFile(file);
    });

    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      input.click();
    });

    if (initialUrl) setUrl(initialUrl);

    return {
      setUrl,
      clear,
      getFile: () => currentFile,
    };
  }

  const scriptLoadPromises = new Map();

  function loadScript(src) {
    if (scriptLoadPromises.has(src)) return scriptLoadPromises.get(src);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      const done = Promise.resolve();
      scriptLoadPromises.set(src, done);
      return done;
    }
    const done = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.body.appendChild(script);
    });
    scriptLoadPromises.set(src, done);
    return done;
  }

  async function ensureCookEditors() {
    await loadScript("js/edit-recipe.js");
    await loadScript("js/manage.js");
  }

  window.CookbookUI = {
    qs,
    qsa,
    el,
    escapeHtml,
    thumbHtml,
    mountShell,
    showStatus,
    mountImagePicker,
    confirmSimilarNames,
    confirmSyncConflict,
    assertNameAvailable,
    refreshSyncButton,
    activateModalFocus,
    deactivateModalFocus,
    loadScript,
    ensureCookEditors,
  };
})();
