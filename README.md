# My Cookbook

A personal recipe book website hosted from this public GitHub repository. Anyone with the link can browse recipes. Only you can add or edit them, using a GitHub personal access token stored in your browser.

**Live site (after Pages is enabled):** https://ozzystrasza.github.io/MyCookbook/

## First-time setup

### 1. Publish with GitHub Desktop

1. Open this repository in GitHub Desktop.
2. Commit all files and push to `main`.

### 2. Turn on GitHub Pages

1. On GitHub, open the repo **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`.
4. Save. Wait a minute, then open https://ozzystrasza.github.io/MyCookbook/

### 3. Create a personal access token (cook only)

1. GitHub → **Settings → Developer settings → Personal access tokens**.
2. Prefer a **fine-grained** token:
   - Resource owner: your account
   - Repository access: **Only select repositories** → `MyCookbook`
   - Permissions → **Repository permissions → Contents**: **Read and write**
3. Generate the token and copy it. You will paste it into the site once per device.

Do not commit the token into the repo. The site keeps it in `localStorage` on that browser only.

## Using the app

### Opening the book

On first visit you choose:

- **Just browsing** — read recipes only. No editor controls.
- **I'm the cook** — paste your token to unlock New recipe, Edit, and Manage.

Use **Sign out** / **Switch role** in the header to return to that gate.

### Cook tools

- **New recipe** — title, category, image, and one or more groups. Each group has ingredients and steps.
- **Manage** — categories, measures (cups, grams, …), and the ingredient catalog (name + picture).
- Recipe lines pick ingredients and measures from those catalogs.

After you save, GitHub stores the JSON and images in this repo. The public site updates when Pages finishes rebuilding (often under a minute).

### Add to Home Screen

- **Android (Chrome):** menu → **Add to Home screen** / **Install app**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Home + cook/visitor gate |
| `recipe.html` | Single recipe |
| `edit.html` | Create/edit recipe (cook) |
| `manage.html` | Categories, measures, ingredients (cook) |
| `data/categories.json` | Category catalog |
| `data/measures.json` | Measure catalog |
| `data/ingredients/` | Ingredient catalog + `_index.json` |
| `data/recipes/` | Recipes + `_index.json` |
| `data/images/` | Ingredient and recipe images |

## Local preview

Opening `index.html` as a `file://` URL often blocks fetching JSON. Use GitHub Pages, or from this folder run:

```bash
npx --yes serve .
```

Then open the URL it prints (usually http://localhost:3000).

## Privacy reminder

This repository is **public**. Recipes and photos are readable by anyone who finds the repo or site URL. Editing still requires your write token (or collaborator access on GitHub).
