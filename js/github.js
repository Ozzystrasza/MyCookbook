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
    const res = await fetch(url, {
      cache: "no-store",
      headers: headers(token),
    });
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

  function decodeContent(file) {
    if (!file?.content) return "";
    const normalized = String(file.content).replace(/\n/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
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
    const contentBase64 = encodeUtf8Base64(text);
    const existing = await getFile(path, token);
    try {
      return await putFile(path, contentBase64, message, token, existing?.sha);
    } catch (err) {
      if (!/does not match/i.test(err?.message || "")) throw err;
      const fresh = await getFile(path, token);
      return putFile(path, contentBase64, message, token, fresh?.sha);
    }
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
      throw new Error("Este token consegue ler o repositório, mas não gravar. Crie um token com Contents: Read and write.");
    }
    return data;
  }

  async function apiJson(url, token, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: headers(token, {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      }),
    });
    if (!res.ok) await parseError(res);
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * One commit for many path changes.
   * changes: [{ path, encoding?: "utf-8"|"base64", content?: string, deleted?: boolean }]
   */
  async function commitChanges(changes, message, token) {
    const list = (changes || []).filter((c) => c && c.path);
    if (!list.length) return null;

    const ref = await apiJson(`${api}/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
    const parentSha = ref?.object?.sha;
    if (!parentSha) throw new Error("Não foi possível ler o branch do repositório.");

    const parentCommit = await apiJson(`${api}/repos/${owner}/${repo}/git/commits/${parentSha}`, token);
    const baseTreeSha = parentCommit?.tree?.sha;
    if (!baseTreeSha) throw new Error("Não foi possível ler a árvore do commit atual.");

    const tree = [];
    for (const change of list) {
      const path = String(change.path).replace(/^\/+/, "");
      if (change.deleted) {
        const existing = await getFile(path, token);
        if (!existing) continue;
        tree.push({ path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const encoding = change.encoding === "base64" ? "base64" : "utf-8";
      const content =
        encoding === "base64"
          ? String(change.content || "")
          : String(change.content ?? "");
      const blob = await apiJson(`${api}/repos/${owner}/${repo}/git/blobs`, token, {
        method: "POST",
        body: JSON.stringify({ content, encoding }),
      });
      if (!blob?.sha) throw new Error(`Falha ao criar blob para ${path}.`);
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }

    if (!tree.length) return null;

    const newTree = await apiJson(`${api}/repos/${owner}/${repo}/git/trees`, token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });
    if (!newTree?.sha) throw new Error("Falha ao criar árvore do commit.");

    const commit = await apiJson(`${api}/repos/${owner}/${repo}/git/commits`, token, {
      method: "POST",
      body: JSON.stringify({
        message: message || "Sincronizar alterações do cookbook",
        tree: newTree.sha,
        parents: [parentSha],
      }),
    });
    if (!commit?.sha) throw new Error("Falha ao criar commit.");

    await apiJson(`${api}/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });

    return commit;
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
    commitChanges,
    validateToken,
    fileToBase64,
    extensionForFile,
    encodeUtf8Base64,
    decodeContent,
  };
})();
