/**
 * Minimal GitHub client for the CMS.
 *
 * Everything the admin does is a Contents API call against one repo, plus the
 * Actions API to report whether a publish actually built. No dependencies, so
 * the admin deploys as plain static files alongside the site.
 */

import { RESTORE_PATHS, backupName, parseBackup, sortBackups } from "../lib/backups.js?v=6600ab59";

const API = "https://api.github.com";

export class GitHub {
  mode = "github";

  constructor({ owner, repo, branch, token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    // path -> blob sha, so updates can prove which revision they replace.
    this.shas = new Map();
  }

  get base() {
    return `${API}/repos/${this.owner}/${this.repo}`;
  }

  async request(url, options = {}) {
    const res = await fetch(url.startsWith("http") ? url : this.base + url, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });

    if (res.status === 401) throw new Error("Sign-in expired or token invalid.");
    if (res.status === 403) {
      if (res.headers.get("x-ratelimit-remaining") === "0") {
        throw new Error("GitHub rate limit reached. Try again in a few minutes.");
      }
      // GitHub's own message distinguishes the causes that all surface as 403 -
      // token not granted to this repo, expired, awaiting org approval, or
      // missing the Contents permission - so pass it through rather than guess.
      let detail = "";
      try {
        detail = (await res.json()).message || "";
      } catch {
        /* not JSON */
      }
      throw new Error(
        `Access denied by GitHub${detail ? `: ${detail}` : ""}. ` +
        "Check the token grants this repository under Repository access, " +
        "and sets Repository permissions -> Contents to Read and write."
      );
    }
    if (res.status === 404) {
      const err = new Error(`Not found: ${url}`);
      err.status = 404;
      throw err;
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).message || "";
      } catch {
        /* response wasn't JSON */
      }
      const err = new Error(`GitHub ${res.status}: ${detail || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async user() {
    return this.request(`${API}/user`);
  }

  /** Confirm the repo exists and the token can actually write to it. */
  async checkAccess() {
    const repo = await this.request("");
    if (!repo.permissions?.push) {
      throw new Error(
        `Signed in, but this account cannot write to ${this.owner}/${this.repo}.`
      );
    }
    return repo;
  }

  async listDir(path) {
    try {
      const items = await this.request(
        `/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`
      );
      return Array.isArray(items) ? items : [];
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  async readFile(path) {
    const data = await this.request(
      `/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`
    );
    this.shas.set(path, data.sha);
    // Base64 -> bytes -> UTF-8, so accented characters survive the round trip.
    const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, "")), (c) =>
      c.charCodeAt(0)
    );
    return new TextDecoder().decode(bytes);
  }

  async readJson(path) {
    return JSON.parse(await this.readFile(path));
  }

  /**
   * Create or update a file.
   *
   * Sends the sha of the revision being replaced; GitHub rejects the write if
   * the file moved on in the meantime, so a stale tab can't clobber a newer
   * edit without the conflict surfacing.
   */
  async writeFile(path, content, message, { base64 = false } = {}) {
    let sha = this.shas.get(path);
    if (!sha) {
      try {
        const meta = await this.request(
          `/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`
        );
        sha = meta.sha;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }

    const body = {
      message,
      branch: this.branch,
      content: base64 ? content : bytesToBase64(new TextEncoder().encode(content)),
      ...(sha ? { sha } : {}),
    };

    const res = await this.request(`/contents/${encodeURI(path)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    this.shas.set(path, res.content.sha);
    return res;
  }

  /** Refuse to overwrite a file someone else changed since it was loaded. */
  async checkUnchanged(changes) {
    for (const c of changes) {
      const known = this.shas.get(c.path);
      if (!known) continue;
      let current = null;
      try {
        current = (await this.request(
          `/contents/${encodeURI(c.path)}?ref=${encodeURIComponent(this.branch)}`
        )).sha;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      if (current && current !== known) {
        throw new Error(`${c.path} was changed elsewhere since you opened it. Reload to get the latest version.`);
      }
    }
  }

  /**
   * Put a new commit on the branch: build(head, baseTree) makes it on top of
   * the current head, then the branch is moved to it - never forced. When the
   * branch moved in between (another save, a deploy commit, or GitHub briefly
   * reporting an older head right after the previous save), GitHub answers
   * "not a fast forward"; the commit is then rebuilt on the new head and tried
   * again, after re-checking that none of these files changed meanwhile.
   */
  async moveBranch(build, changes = []) {
    for (let attempt = 0; ; attempt++) {
      const ref = await this.request(`/git/ref/heads/${encodeURIComponent(this.branch)}?t=${Date.now()}`);
      const head = ref.object.sha;
      const baseTree = (await this.request(`/git/commits/${head}`)).tree.sha;
      const commitSha = await build(head, baseTree);
      try {
        await this.request(`/git/refs/heads/${encodeURIComponent(this.branch)}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: commitSha, force: false }),
        });
        return commitSha;
      } catch (err) {
        const raced = err.status === 422 && /fast.?forward/i.test(err.message);
        if (!raced || attempt >= 5) {
          if (raced) throw new Error("The site was being updated at the same moment and the save couldn't go through. Your changes are still here - press Save again.");
          throw err;
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        await this.checkUnchanged(changes);
      }
    }
  }

  /**
   * Write and delete several files as one commit.
   *
   * Reordering touches every project, a rename writes one file and deletes
   * another, a delete may clear references elsewhere - as separate Contents API
   * calls each would be its own commit and its own deploy, and a failure
   * halfway would leave the collection inconsistent. The Git Data API applies
   * them atomically: the branch only moves if the whole commit lands.
   *
   * changes: [{ path, content: string | null, base64?: boolean }]
   */
  async commit(changes, message) {
    await this.checkUnchanged(changes);

    // The file contents are uploaded once; only the tree and commit are
    // rebuilt if the branch moved meanwhile.
    const blobShas = new Map();
    for (const c of changes) {
      if (c.content == null) continue;
      const blob = await this.request("/git/blobs", {
        method: "POST",
        body: JSON.stringify({
          content: c.base64 ? c.content : bytesToBase64(new TextEncoder().encode(c.content)),
          encoding: "base64",
        }),
      });
      blobShas.set(c.path, blob.sha);
    }
    const tree = changes.map((c) => ({ path: c.path, mode: "100644", type: "blob", sha: c.content == null ? null : blobShas.get(c.path) }));

    let commit = null;
    await this.moveBranch(async (head, baseTree) => {
      const newTree = await this.request("/git/trees", {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTree, tree }),
      });
      commit = await this.request("/git/commits", {
        method: "POST",
        body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }),
      });
      return commit.sha;
    }, changes);

    for (const c of changes) {
      if (c.content == null) this.shas.delete(c.path);
      else this.shas.set(c.path, blobShas.get(c.path));
    }
    return commit;
  }

  async deleteFile(path, message) {
    let sha = this.shas.get(path);
    if (!sha) {
      const meta = await this.request(
        `/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`
      );
      sha = meta.sha;
    }
    await this.request(`/contents/${encodeURI(path)}`, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
    this.shas.delete(path);
  }

  /** Most recent workflow run, used to show real publish status. */
  async latestRun() {
    const data = await this.request(
      `/actions/runs?branch=${encodeURIComponent(this.branch)}&per_page=1`
    );
    return data.workflow_runs?.[0] || null;
  }

  /* ------------------------------------------------------------ backups --
   * Tags named backup/<time>-<kind> (admin/lib/backups.js).
   */

  async listBackups() {
    const refs = await this.request("/git/matching-refs/tags/backup/").catch((err) => { if (err.status === 404) return []; throw err; });
    return sortBackups(refs.map((r) => {
      const b = parseBackup(r.ref);
      return b && { ...b, sha: r.object.sha };
    }).filter(Boolean));
  }

  async createBackup(kind = "manual") {
    const head = (await this.request(`/git/ref/heads/${encodeURIComponent(this.branch)}`)).object.sha;
    let name = backupName(kind);
    // Two in the same second (a restore right after "Back up now"): next second.
    for (let i = 1; (await this.listBackups()).some((b) => b.name === name); i++) name = backupName(kind, new Date(Date.now() + i * 1000));
    await this.request("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/tags/${name}`, sha: head }) });
    return { ...parseBackup(name), sha: head };
  }

  async deleteBackup(name) {
    if (!parseBackup(name)) throw new Error(`${name} isn't a backup`);
    await this.request(`/git/refs/tags/${name.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
  }

  /** The sha of the tree at `path` inside `treeSha`, or null if it isn't there. */
  async subtree(treeSha, path) {
    let sha = treeSha;
    for (const part of path.split("/")) {
      const tree = await this.request(`/git/trees/${sha}`);
      const entry = tree.tree.find((e) => e.path === part && e.type === "tree");
      if (!entry) return null;
      sha = entry.sha;
    }
    return sha;
  }

  /**
   * Put the CMS-edited folders back as they were in a backup, as one commit
   * on top of the branch (history keeps everything, so it can be undone).
   */
  async restoreBackup(name) {
    const backup = (await this.listBackups()).find((b) => b.name === name);
    if (!backup) throw new Error(`No backup called ${name}`);
    const commitSha = backup.sha;
    // An annotated tag points at a tag object; a lightweight one at the commit.
    const target = await this.request(`/git/commits/${commitSha}`).catch(async () => (await this.request(`/git/tags/${commitSha}`)).object);
    const backupTree = target.tree?.sha || (await this.request(`/git/commits/${target.sha}`)).tree.sha;
    const when = backup.date.toISOString().slice(0, 16).replace("T", " ");
    let changed = true;
    await this.moveBranch(async (head, baseTree) => {
      const tree = [];
      for (const p of RESTORE_PATHS) {
        const [then, now] = await Promise.all([this.subtree(backupTree, p), this.subtree(baseTree, p)]);
        if (then === now) continue;
        // Only plain files and folders come back (no links to elsewhere, no submodules).
        if (then) {
          const all = await this.request(`/git/trees/${then}?recursive=1`);
          if (all.tree.some((e) => e.mode === "120000" || e.mode === "160000")) throw new Error(`The backup's ${p} folder contains links; it wasn't restored.`);
        }
        tree.push({ path: p, mode: "040000", type: "tree", sha: then });
      }
      if (!tree.length) { changed = false; throw Object.assign(new Error("nothing to restore"), { nothing: true }); }
      const newTree = await this.request("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
      const commit = await this.request("/git/commits", {
        method: "POST",
        body: JSON.stringify({ message: `CMS: restore backup from ${when} UTC (${name})`, tree: newTree.sha, parents: [head] }),
      });
      return commit.sha;
    }).catch((err) => { if (!err.nothing) throw err; });
    if (!changed) return { changed: false };
    this.shas.clear();
    return { changed: true };
  }

  /** GitHub serves the .zip to anyone signed in to github.com with access to the repository. */
  backupDownloadUrl(name) {
    return `https://github.com/${this.owner}/${this.repo}/archive/refs/tags/${name}.zip`;
  }
}

export function bytesToBase64(bytes) {
  // Chunked: spreading a multi-MB array into String.fromCharCode blows the
  // call stack, and uploads here are image-sized.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
