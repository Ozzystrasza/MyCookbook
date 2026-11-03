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
          ${cook ? `<a href="edit.html" class="${active === "edit" ? "is-active" : ""}" data-cook-only>Nova receita</a>` : ""}
          ${cook ? `<a href="manage.html" class="${active === "manage" ? "is-active" : ""}" data-cook-only>Gerenciar</a>` : ""}
          <button type="button" class="linkish" data-sign-out>${cook ? "Sair" : "Trocar perfil"}</button>
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
