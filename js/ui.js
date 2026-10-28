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
    header.innerHTML = `
      <div class="site-header__inner">
        <a class="brand" href="index.html">My Cookbook</a>
        <nav class="site-nav" aria-label="Primary">
          <a href="index.html" class="${active === "home" ? "is-active" : ""}">Recipes</a>
          ${cook ? `<a href="edit.html" class="${active === "edit" ? "is-active" : ""}" data-cook-only>New recipe</a>` : ""}
          ${cook ? `<a href="manage.html" class="${active === "manage" ? "is-active" : ""}" data-cook-only>Manage</a>` : ""}
          <button type="button" class="linkish" data-sign-out>${cook ? "Sign out" : "Switch role"}</button>
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
