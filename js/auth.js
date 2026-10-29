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
        <div class="gate__panel" data-gate-step="choice">
          <h1 id="gate-title" class="gate__title">My Cookbook</h1>
          <div class="gate__actions">
            <button type="button" class="btn btn--primary" data-gate="cook">Open Book</button>
            <button type="button" class="btn btn--ghost" data-gate="visitor">Peek Inside</button>
          </div>
        </div>
        <div class="gate__panel" data-gate-step="token" hidden>
          <button type="button" class="gate__back" data-gate-back aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <h1 id="gate-token-title" class="gate__title gate__title--sm">Open Book</h1>
          <form class="gate__cook" data-gate-cook>
            <div class="field">
              <input
                type="password"
                name="token"
                autocomplete="off"
                placeholder="Password"
                aria-label="Password"
                required
              />
            </div>
            <p class="form-error" data-gate-error hidden></p>
            <button type="submit" class="btn btn--primary">Open</button>
          </form>
        </div>
      </div>
    `;

    const choiceStep = container.querySelector('[data-gate-step="choice"]');
    const tokenStep = container.querySelector('[data-gate-step="token"]');
    const cookForm = container.querySelector("[data-gate-cook]");
    const errorEl = container.querySelector("[data-gate-error]");

    function showChoiceStep() {
      cookForm.reset();
      errorEl.hidden = true;
      tokenStep.hidden = true;
      choiceStep.hidden = false;
      container.querySelector(".gate").setAttribute("aria-labelledby", "gate-title");
    }

    function showTokenStep() {
      choiceStep.hidden = true;
      tokenStep.hidden = false;
      container.querySelector(".gate").setAttribute("aria-labelledby", "gate-token-title");
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
        submit.textContent = "Open";
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
