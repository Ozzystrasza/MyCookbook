(function () {
  const { storageKeys } = window.CookbookConfig;

  function getRole() {
    return localStorage.getItem(storageKeys.role);
  }

  function getToken() {
    return localStorage.getItem(storageKeys.token) || "";
  }

  function isCook() {
    return getRole() === "cook" && Boolean(getToken());
  }

  function isVisitor() {
    return getRole() === "visitor";
  }

  function hasChosenRole() {
    return getRole() === "visitor" || isCook();
  }

  function setVisitor() {
    localStorage.setItem(storageKeys.role, "visitor");
    localStorage.removeItem(storageKeys.token);
  }

  async function setCook(token) {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Paste a GitHub personal access token.");
    await window.CookbookGitHub.validateToken(trimmed);
    localStorage.setItem(storageKeys.role, "cook");
    localStorage.setItem(storageKeys.token, trimmed);
  }

  function signOut() {
    localStorage.removeItem(storageKeys.role);
    localStorage.removeItem(storageKeys.token);
  }

  function requireCookOrRedirect() {
    if (isCook()) return true;
    window.location.href = "index.html";
    return false;
  }

  function applyCookUi(root = document) {
    root.querySelectorAll("[data-cook-only]").forEach((el) => {
      el.hidden = !isCook();
    });
    root.querySelectorAll("[data-visitor-only]").forEach((el) => {
      el.hidden = isCook();
    });
  }

  function renderGate(container) {
    container.innerHTML = `
      <div class="gate" role="dialog" aria-labelledby="gate-title">
        <div class="gate__panel">
          <p class="gate__eyebrow">Welcome</p>
          <h1 id="gate-title" class="gate__title">My Cookbook</h1>
          <p class="gate__copy" data-gate-copy>Choose how you want to open the book.</p>
          <div class="gate__actions" data-gate-actions>
            <button type="button" class="btn btn--primary" data-gate="cook">Open Book</button>
            <button type="button" class="btn btn--ghost" data-gate="visitor">Peek Inside</button>
          </div>
          <form class="gate__cook" data-gate-cook hidden>
            <label class="field">
              <span>GitHub personal access token</span>
              <input type="password" name="token" autocomplete="off" placeholder="ghp_…" required />
            </label>
            <p class="hint">Use a fine-scoped token with Contents read/write on the MyCookbook repo only. Stored only in this browser.</p>
            <p class="form-error" data-gate-error hidden></p>
            <button type="submit" class="btn btn--primary">Unlock editor</button>
            <button type="button" class="linkish" data-gate-back>Back</button>
          </form>
        </div>
      </div>
    `;

    const cookForm = container.querySelector("[data-gate-cook]");
    const actions = container.querySelector("[data-gate-actions]");
    const copy = container.querySelector("[data-gate-copy]");
    const errorEl = container.querySelector("[data-gate-error]");

    function showChoiceStep() {
      cookForm.hidden = true;
      cookForm.reset();
      errorEl.hidden = true;
      actions.hidden = false;
      copy.hidden = false;
    }

    function showTokenStep() {
      actions.hidden = true;
      copy.hidden = true;
      cookForm.hidden = false;
      cookForm.querySelector('input[name="token"]').focus();
    }

    container.querySelector('[data-gate="visitor"]').addEventListener("click", () => {
      setVisitor();
      container.remove();
      document.body.classList.remove("is-gated");
      window.dispatchEvent(new CustomEvent("cookbook:ready"));
    });

    container.querySelector('[data-gate="cook"]').addEventListener("click", showTokenStep);
    container.querySelector("[data-gate-back]").addEventListener("click", showChoiceStep);

    cookForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      const token = new FormData(cookForm).get("token");
      const submit = cookForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Checking…";
      try {
        await setCook(String(token || ""));
        container.remove();
        document.body.classList.remove("is-gated");
        window.dispatchEvent(new CustomEvent("cookbook:ready"));
      } catch (err) {
        errorEl.textContent = err.message || "Could not validate token.";
        errorEl.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = "Unlock editor";
      }
    });
  }

  function ensureSession() {
    if (hasChosenRole()) {
      document.body.classList.remove("is-gated");
      window.dispatchEvent(new CustomEvent("cookbook:ready"));
      return;
    }
    document.body.classList.add("is-gated");
    let host = document.getElementById("auth-gate");
    if (!host) {
      host = document.createElement("div");
      host.id = "auth-gate";
      document.body.prepend(host);
    }
    renderGate(host);
  }

  window.CookbookAuth = {
    getRole,
    getToken,
    isCook,
    isVisitor,
    hasChosenRole,
    setVisitor,
    setCook,
    signOut,
    requireCookOrRedirect,
    applyCookUi,
    ensureSession,
  };
})();
