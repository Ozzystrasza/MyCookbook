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

    qs("[data-sign-out]", header)?.addEventListener("click", () => {
      window.CookbookAuth.signOut();
      window.location.href = "index.html";
    });

    window.CookbookAuth.applyCookUi(document);
  }

  function showStatus(elNode, message, kind = "info") {
    if (!elNode) return;
    elNode.hidden = !message;
    elNode.textContent = message || "";
    elNode.className = `status status--${kind}`;
  }

  window.CookbookUI = {
    qs,
    qsa,
    el,
    mountShell,
    showStatus,
  };
})();
