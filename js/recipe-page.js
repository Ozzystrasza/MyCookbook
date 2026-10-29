(function () {
  const params = new URLSearchParams(window.location.search);
  const recipeId = params.get("id");
  if (recipeId) {
    window.location.replace(`index.html?recipe=${encodeURIComponent(recipeId)}`);
    return;
  }
  window.location.replace("index.html");
})();
