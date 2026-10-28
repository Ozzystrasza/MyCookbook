(function () {
  const { owner, repo, branch } = window.CookbookConfig;
  const api = "https://api.github.com";

  function headers(token, extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async function parseError(res) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message || detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }

  async function getFile(path, token) {
    const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${branch}`;
    const res = await fetch(url, { headers: headers(token) });
    if (res.status === 404) return null;
    if (!res.ok) await parseError(res);
    return res.json();
  }

  function encodeUtf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  async function putFile(path, contentBase64, message, token, sha) {
    const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
    const body = {
      message,
      content: contentBase64,
      branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) await parseError(res);
    return res.json();
  }

  async function putTextFile(path, text, message, token) {
    const existing = await getFile(path, token);
    return putFile(path, encodeUtf8Base64(text), message, token, existing?.sha);
  }

  async function putJsonFile(path, data, message, token) {
    return putTextFile(path, JSON.stringify(data, null, 2) + "\n", message, token);
  }

  async function deleteFile(path, message, token) {
    const existing = await getFile(path, token);
    if (!existing) return null;
    const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message,
        sha: existing.sha,
        branch,
      }),
    });
    if (!res.ok) await parseError(res);
    return res.json();
  }

  async function validateToken(token) {
    const res = await fetch(`${api}/repos/${owner}/${repo}`, {
      headers: headers(token),
    });
    if (!res.ok) await parseError(res);
    const data = await res.json();
    if (data.permissions && data.permissions.push === false) {
      throw new Error("This token can read the repo but cannot write. Create a token with Contents: Read and write.");
    }
    return data;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = String(result).split(",")[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function extensionForFile(file) {
    const name = file.name || "";
    const dot = name.lastIndexOf(".");
    if (dot >= 0) return name.slice(dot).toLowerCase();
    if (file.type === "image/png") return ".png";
    if (file.type === "image/webp") return ".webp";
    if (file.type === "image/gif") return ".gif";
    return ".jpg";
  }

  window.CookbookGitHub = {
    getFile,
    putFile,
    putTextFile,
    putJsonFile,
    deleteFile,
    validateToken,
    fileToBase64,
    extensionForFile,
    encodeUtf8Base64,
  };
})();
