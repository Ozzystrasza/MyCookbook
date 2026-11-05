(function () {
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return [...root.querySelectorAll(sel)];
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

  function mountShell({ active } = {}) {
    const header = qs("[data-site-header]");
    if (!header) return;

    const cook = window.CookbookAuth.isCook();
    const showBack = active === "edit" || active === "manage";
    const backLink = showBack
      ? `<a href="index.html" class="icon-btn" aria-label="Voltar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>`
      : "";

    header.innerHTML = `
      <div class="site-header__inner">
        <div class="site-header__brand-row">
          ${backLink}
          <a class="brand" href="index.html">My Cookbook</a>
        </div>
        <nav class="site-nav" aria-label="Principal">
          ${cook ? `<a href="edit.html" class="icon-btn${active === "edit" ? " is-active" : ""}" data-cook-only title="Nova receita" aria-label="Nova receita">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
            </svg>
          </a>` : ""}
          ${cook ? `<a href="manage.html" class="icon-btn${active === "manage" ? " is-active" : ""}" data-cook-only title="Gerenciar" aria-label="Gerenciar">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 5.5h9M3.5 10h13M3.5 14.5h9" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
              <circle cx="15.5" cy="5.5" r="1.75" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="8.5" cy="10" r="1.75" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="15.5" cy="14.5" r="1.75" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </a>` : ""}
          <button type="button" class="icon-btn" data-shopping-toggle title="Lista de compras" aria-label="Lista de compras">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3.5 4.5h1.2l1.1 8.2a1.5 1.5 0 0 0 1.5 1.3h6.9a1.5 1.5 0 0 0 1.5-1.2l1.1-5.3H6.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="8.2" cy="16.2" r="1.1" fill="currentColor"/>
              <circle cx="14" cy="16.2" r="1.1" fill="currentColor"/>
            </svg>
          </button>
          <button type="button" class="icon-btn" data-sign-out title="${cook ? "Sair" : "Trocar perfil"}" aria-label="${cook ? "Sair" : "Trocar perfil"}">
            ${cook
              ? `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8a1.5 1.5 0 0 0 1.5 1.5H8M11.5 13.5 15.5 10 11.5 6.5M15.5 10H8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`
              : `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.75"/>
                  <path d="M4.5 16.5c.9-2.6 2.9-4 5.5-4s4.6 1.4 5.5 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
                </svg>`}
          </button>
        </nav>
      </div>
    `;

    window.CookbookShopping?.bindHeaderToggle(header);
    window.CookbookAuth.applyCookUi(document);
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
  }

  function mountImagePicker(container, { initialUrl = "", onChange } = {}) {
    if (!container) return null;

    let objectUrl = null;
    let currentFile = null;
    let dragDepth = 0;

    const minusIcon = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;

    container.innerHTML = `
      <div class="image-drop" data-image-drop tabindex="0" role="button" aria-label="Toque ou arraste uma foto">
        <input type="file" accept="image/*" hidden data-image-input />
        <div class="image-drop__empty" data-image-empty>Toque ou arraste uma foto</div>
        <div class="image-drop__preview" data-image-preview hidden>
          <img class="image-drop__img" data-image-thumb alt="" />
          <button type="button" class="icon-btn image-drop__remove" data-image-remove aria-label="Remover imagem" title="Remover">${minusIcon}</button>
        </div>
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
      empty.hidden = false;
      preview.hidden = true;
      thumb.removeAttribute("src");
      root.classList.remove("has-image");
    }

    function showPreview(url) {
      empty.hidden = true;
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

  window.CookbookUI = {
    qs,
    qsa,
    el,
    mountShell,
    showStatus,
    mountImagePicker,
  };
})();
