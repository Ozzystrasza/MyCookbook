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
    if (!trimmed) throw new Error("Cole um token de acesso pessoal do GitHub.");
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

  function isBookAppPage() {
    return Boolean(document.querySelector("[data-book]"));
  }

  function coverFaceHtml() {
    return `
      <div class="book-cover" role="dialog" aria-labelledby="gate-title">
        <div class="book-cover__body">
          <h1 id="gate-title" class="book-cover__title">My Cookbook</h1>
          <div class="book-cover__step" data-gate-step="choice">
            <div class="book-cover__panel book-cover__actions">
              <button type="button" class="btn btn--primary" data-gate="cook">Abrir livro</button>
              <button type="button" class="btn btn--ghost" data-gate="visitor">Dar uma espiada</button>
            </div>
          </div>
          <div class="book-cover__step" data-gate-step="token" hidden>
            <button type="button" class="book-cover__back" data-gate-back aria-label="Voltar">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <form class="book-cover__panel book-cover__cook" data-gate-cook>
              <div class="field">
                <input
                  type="password"
                  name="token"
                  autocomplete="off"
                  placeholder="Senha"
                  aria-label="Senha"
                  required
                />
              </div>
              <p class="form-error" data-gate-error hidden></p>
              <button type="submit" class="btn btn--primary">Abrir</button>
            </form>
          </div>
        </div>
        <p class="book-cover__byline">By: Oziris Moreira</p>
      </div>
    `;
  }

  function bindCoverGate(root, onUnlocked) {
    if (!root) return;
    root._coverUnlocked = onUnlocked;
    if (window.__cookbookCoverGateBound) return;
    window.__cookbookCoverGateBound = true;

    function activeRoot() {
      return document.querySelector("[data-flip-slot]") || root;
    }

    function covers() {
      return [...document.querySelectorAll(".book-cover")];
    }

    function showChoiceStep() {
      covers().forEach((cover) => {
        const choiceStep = cover.querySelector('[data-gate-step="choice"]');
        const tokenStep = cover.querySelector('[data-gate-step="token"]');
        const cookForm = cover.querySelector("[data-gate-cook]");
        const errorEl = cover.querySelector("[data-gate-error]");
        cookForm?.reset();
        if (errorEl) errorEl.hidden = true;
        if (tokenStep) tokenStep.hidden = true;
        if (choiceStep) choiceStep.hidden = false;
      });
    }

    function showTokenStep() {
      covers().forEach((cover) => {
        const choiceStep = cover.querySelector('[data-gate-step="choice"]');
        const tokenStep = cover.querySelector('[data-gate-step="token"]');
        if (choiceStep) choiceStep.hidden = true;
        if (tokenStep) tokenStep.hidden = false;
      });
      document.querySelector('.book-cover [data-gate-step="token"]:not([hidden]) input[name="token"]')?.focus();
    }

    function unlock() {
      activeRoot()?._coverUnlocked?.();
    }

    document.addEventListener(
      "pointerup",
      (event) => {
        if (!document.body.classList.contains("is-gated")) return;
        if (event.target.closest('[data-gate="visitor"]')) {
          event.preventDefault();
          event.stopPropagation();
          setVisitor();
          unlock();
          return;
        }
        if (event.target.closest('[data-gate="cook"]')) {
          event.preventDefault();
          event.stopPropagation();
          showTokenStep();
          return;
        }
        if (event.target.closest("[data-gate-back]")) {
          event.preventDefault();
          event.stopPropagation();
          showChoiceStep();
        }
      },
      true
    );

    document.addEventListener(
      "submit",
      async (event) => {
        const cookForm = event.target.closest?.("[data-gate-cook]") || (event.target.matches?.("[data-gate-cook]") ? event.target : null);
        if (!cookForm) return;
        event.preventDefault();
        const cover = cookForm.closest(".book-cover");
        const errorEl = cover?.querySelector("[data-gate-error]");
        if (errorEl) errorEl.hidden = true;
        const token = new FormData(cookForm).get("token");
        const submit = cookForm.querySelector('button[type="submit"]');
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Verificando…";
        }
        try {
          await setCook(String(token || ""));
          unlock();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || "Não foi possível validar o token.";
            errorEl.hidden = false;
          }
        } finally {
          if (submit) {
            submit.disabled = false;
            submit.textContent = "Abrir";
          }
        }
      },
      true
    );
  }

  function ensureSession() {
    if (!isBookAppPage()) {
      if (!hasChosenRole()) {
        window.location.href = "index.html";
        return;
      }
      document.body.classList.remove("is-gated");
      window.dispatchEvent(new CustomEvent("cookbook:ready"));
      return;
    }

    document.body.classList.add("is-gated");
    const host = document.getElementById("auth-gate");
    if (host) host.replaceChildren();
    window.dispatchEvent(new CustomEvent("cookbook:ready"));
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
    coverFaceHtml,
    bindCoverGate,
  };
})();
