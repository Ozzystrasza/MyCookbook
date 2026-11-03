(function () {
  const { qs, showStatus } = window.CookbookUI;
  const params = new URLSearchParams(window.location.search);
  const editingId = params.get("id");

  let categories = [];
  let measures = [];
  let ingredients = [];
  let recipeIndex = [];
  let currentImagePath = "";
  let imageFile = null;

  function blankGroup() {
    return {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "",
      ingredients: [{ ingredientId: "", measureId: "", quantity: "" }],
      steps: [{ description: "" }],
    };
  }

  function optionList(items, selected, labelKey = "name") {
    return [
      `<option value="">Selecione…</option>`,
      ...items.map(
        (item) =>
          `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${item[labelKey]}</option>`
      ),
    ].join("");
  }

  function renderGroups(groups) {
    const host = qs("[data-groups-editor]");
    host.innerHTML = "";
    groups.forEach((group, groupIndex) => {
      const wrap = document.createElement("div");
      wrap.className = "group-editor";
      wrap.dataset.groupIndex = String(groupIndex);
      wrap.innerHTML = `
        <div class="row row--2">
          <label class="field">
            <span>Nome do grupo</span>
            <input data-field="name" value="${group.name || ""}" placeholder="Massa, Cobertura…" />
          </label>
          <div class="actions" style="align-items:end">
            <button type="button" class="btn btn--ghost btn--small" data-remove-group>Remover grupo</button>
          </div>
        </div>
        <div>
          <div class="toolbar">
            <strong>Ingredientes</strong>
            <button type="button" class="btn btn--ghost btn--small" data-add-ingredient>Adicionar ingrediente</button>
          </div>
          <div data-ingredient-lines></div>
        </div>
        <div>
          <div class="toolbar">
            <strong>Passos</strong>
            <button type="button" class="btn btn--ghost btn--small" data-add-step>Adicionar passo</button>
          </div>
          <div data-step-lines></div>
        </div>
      `;

      const ingredientHost = wrap.querySelector("[data-ingredient-lines]");
      (group.ingredients || []).forEach((line, lineIndex) => {
        const row = document.createElement("div");
        row.className = "line-row ingredients";
        row.innerHTML = `
          <label class="field">
            <span>Ingrediente</span>
            <select data-field="ingredientId">${optionList(ingredients, line.ingredientId)}</select>
          </label>
          <label class="field">
            <span>Medida</span>
            <select data-field="measureId">${optionList(measures, line.measureId)}</select>
          </label>
          <label class="field">
            <span>Quantidade</span>
            <input data-field="quantity" value="${line.quantity ?? ""}" placeholder="2 ou 1/2" />
          </label>
          <div class="actions" style="align-items:end">
            <button type="button" class="btn btn--ghost btn--small" data-remove-ingredient>Remover</button>
          </div>
        `;
        row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
          const current = readGroupsFromDom();
          current[groupIndex].ingredients.splice(lineIndex, 1);
          if (!current[groupIndex].ingredients.length) {
            current[groupIndex].ingredients.push({ ingredientId: "", measureId: "", quantity: "" });
          }
          renderGroups(current);
        });
        ingredientHost.append(row);
      });

      const stepHost = wrap.querySelector("[data-step-lines]");
      (group.steps || []).forEach((step, stepIndex) => {
        const row = document.createElement("div");
        row.className = "line-row steps";
        row.innerHTML = `
          <label class="field">
            <span>Passo</span>
            <textarea data-field="description" placeholder="O que fazer…">${step.description || ""}</textarea>
          </label>
          <div class="actions" style="align-items:end">
            <button type="button" class="btn btn--ghost btn--small" data-remove-step>Remover</button>
          </div>
        `;
        row.querySelector("[data-remove-step]").addEventListener("click", () => {
          const current = readGroupsFromDom();
          current[groupIndex].steps.splice(stepIndex, 1);
          if (!current[groupIndex].steps.length) {
            current[groupIndex].steps.push({ description: "" });
          }
          renderGroups(current);
        });
        stepHost.append(row);
      });

      wrap.querySelector("[data-add-ingredient]").addEventListener("click", () => {
        const current = readGroupsFromDom();
        current[groupIndex].ingredients.push({ ingredientId: "", measureId: "", quantity: "" });
        renderGroups(current);
      });
      wrap.querySelector("[data-add-step]").addEventListener("click", () => {
        const current = readGroupsFromDom();
        current[groupIndex].steps.push({ description: "" });
        renderGroups(current);
      });
      wrap.querySelector("[data-remove-group]").addEventListener("click", () => {
        const current = readGroupsFromDom();
        current.splice(groupIndex, 1);
        renderGroups(current.length ? current : [blankGroup()]);
      });

      host.append(wrap);
    });
  }

  function readGroupsFromDom() {
    const usedIds = new Set();
    return [...qs("[data-groups-editor]").children].map((wrap, index) => {
      const name = wrap.querySelector('[data-field="name"]').value.trim();
      const idBase = name || `group-${index + 1}`;
      let id = window.CookbookData.slugify(idBase);
      if (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      const ingredientsLines = [...wrap.querySelectorAll("[data-ingredient-lines] .line-row")].map((row) => ({
        ingredientId: row.querySelector('[data-field="ingredientId"]').value,
        measureId: row.querySelector('[data-field="measureId"]').value,
        quantity: row.querySelector('[data-field="quantity"]').value.trim(),
      }));
      const steps = [...wrap.querySelectorAll("[data-step-lines] .line-row")].map((row) => ({
        description: row.querySelector('[data-field="description"]').value.trim(),
      }));
      return {
        id,
        name,
        ingredients: ingredientsLines.filter((l) => l.ingredientId),
        steps: steps.filter((s) => s.description),
      };
    });
  }

  function fillForm(recipe) {
    qs("#title").value = recipe.title || "";
    qs("#categoryId").innerHTML = optionList(categories, recipe.categoryId);
    currentImagePath = recipe.image || "";
    qs("[data-current-image]").textContent = currentImagePath
      ? `Imagem atual: ${currentImagePath}`
      : "Nenhuma imagem ainda.";
    renderGroups(recipe.groups?.length ? recipe.groups : [blankGroup()]);
  }

  async function saveRecipe(event) {
    event.preventDefault();
    const status = qs("[data-status]");
    const token = window.CookbookAuth.getToken();
    const title = qs("#title").value.trim();
    const categoryId = qs("#categoryId").value;
    if (!title) {
      showStatus(status, "O título é obrigatório.", "error");
      return;
    }
    if (!categoryId) {
      showStatus(status, "Escolha uma categoria.", "error");
      return;
    }

    const groups = readGroupsFromDom().filter((g) => g.name || g.ingredients.length || g.steps.length);
    if (!groups.length) {
      showStatus(status, "Adicione pelo menos um grupo.", "error");
      return;
    }

    const existingIds = new Set(recipeIndex.map((r) => r.id));
    if (editingId) existingIds.delete(editingId);
    const id = editingId || window.CookbookData.uniqueId(title, existingIds);

    const submit = qs('[type="submit"]');
    submit.disabled = true;
    showStatus(status, "Salvando no GitHub…", "info");

    try {
      let imagePath = currentImagePath;
      if (imageFile) {
        const ext = window.CookbookGitHub.extensionForFile(imageFile);
        imagePath = `data/images/recipes/${id}${ext}`;
        const base64 = await window.CookbookGitHub.fileToBase64(imageFile);
        await window.CookbookGitHub.putFile(
          imagePath,
          base64,
          `Atualizar imagem da receita: ${title}`,
          token,
          (await window.CookbookGitHub.getFile(imagePath, token))?.sha
        );
      }

      const recipe = {
        id,
        title,
        categoryId,
        image: imagePath,
        groups,
        updatedAt: new Date().toISOString(),
      };

      await window.CookbookGitHub.putJsonFile(
        `data/recipes/${id}.json`,
        recipe,
        `${editingId ? "Atualizar" : "Adicionar"} receita: ${title}`,
        token
      );

      const nextIndex = recipeIndex.filter((r) => r.id !== id);
      nextIndex.unshift({
        id,
        title,
        categoryId,
        image: imagePath,
      });
      await window.CookbookGitHub.putJsonFile(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após ${title}`,
        token
      );

      showStatus(status, "Salvo. O GitHub Pages pode levar um minuto para atualizar.", "ok");
      window.setTimeout(() => {
        window.location.href = `recipe.html?id=${encodeURIComponent(id)}`;
      }, 900);
    } catch (err) {
      showStatus(status, err.message || "Falha ao salvar.", "error");
      submit.disabled = false;
    }
  }

  async function deleteRecipe() {
    if (!editingId) return;
    if (!window.confirm("Excluir esta receita do repositório?")) return;
    const status = qs("[data-status]");
    const token = window.CookbookAuth.getToken();
    showStatus(status, "Excluindo…", "info");
    try {
      await window.CookbookGitHub.deleteFile(
        `data/recipes/${editingId}.json`,
        `Excluir receita ${editingId}`,
        token
      );
      if (currentImagePath && currentImagePath.startsWith("data/images/recipes/")) {
        await window.CookbookGitHub.deleteFile(
          currentImagePath,
          `Excluir imagem da receita ${editingId}`,
          token
        );
      }
      const nextIndex = recipeIndex.filter((r) => r.id !== editingId);
      await window.CookbookGitHub.putJsonFile(
        "data/recipes/_index.json",
        nextIndex,
        `Atualizar índice de receitas após excluir ${editingId}`,
        token
      );
      window.location.href = "index.html";
    } catch (err) {
      showStatus(status, err.message || "Falha ao excluir.", "error");
    }
  }

  async function boot() {
    if (!window.CookbookAuth.requireCookOrRedirect()) return;
    window.CookbookUI.mountShell({ active: "edit" });

    [categories, measures, ingredients, recipeIndex] = await Promise.all([
      window.CookbookData.loadCategories(),
      window.CookbookData.loadMeasures(),
      window.CookbookData.loadIngredientIndex(),
      window.CookbookData.loadRecipeIndex(),
    ]);

    qs("#page-title").textContent = editingId ? "Editar receita" : "Nova receita";
    qs("[data-delete]")?.toggleAttribute("hidden", !editingId);

    if (editingId) {
      const recipe = await window.CookbookData.loadRecipe(editingId);
      fillForm(recipe);
    } else {
      fillForm({ title: "", categoryId: "", image: "", groups: [blankGroup()] });
    }

    qs("#image").addEventListener("change", (event) => {
      imageFile = event.target.files?.[0] || null;
    });
    qs("#recipe-form").addEventListener("submit", saveRecipe);
    qs("[data-add-group]").addEventListener("click", () => {
      const groups = readGroupsFromDom();
      groups.push(blankGroup());
      renderGroups(groups);
    });
    qs("[data-delete]")?.addEventListener("click", deleteRecipe);
  }

  window.addEventListener("cookbook:ready", () => {
    boot().catch((err) => {
      showStatus(qs("[data-status]"), err.message, "error");
    });
  });
  window.CookbookAuth.ensureSession();
})();
