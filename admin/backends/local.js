/**
 * Backend for the local CMS (tools/cms-server.mjs).
 *
 * Same interface as the GitHub backend, so the rest of the CMS doesn't know
 * which one it is talking to. Files are read from and written to the working
 * tree; the server rebuilds the site after every save.
 */

import { bytesToBase64 } from "./github.js?v=6600ab59";

const API = "/__cms/api";

const decode = (b64) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

export class Local {
  mode = "local";

  constructor() {
    this.shas = new Map();
  }

  /** Resolves to a backend when the page is served by the local CMS server. */
  static async detect() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    try {
      const res = await fetch(`${API}/info`, { cache: "no-store" });
      if (!res.ok) return null;
      const info = await res.json();
      return info.mode === "local" ? new Local() : null;
    } catch {
      return null;
    }
  }

  async request(url, options = {}) {
    const res = await fetch(API + url, {
      cache: "no-store",
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : {},
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error(data?.message || `Local CMS server: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async user() {
    return { login: "Local", avatar_url: "" };
  }

  async checkAccess() {
    return true;
  }

  async listDir(path) {
    try {
      const items = await this.request(`/contents?path=${encodeURIComponent(path)}`);
      return Array.isArray(items) ? items : [];
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  async readFile(path) {
    const data = await this.request(`/contents?path=${encodeURIComponent(path)}`);
    this.shas.set(path, data.sha);
    return decode(data.content);
  }

  async readJson(path) {
    return JSON.parse(await this.readFile(path));
  }

  async commit(changes, message) {
    const body = {
      message,
      changes: changes.map((c) => ({
        path: c.path,
        sha: this.shas.get(c.path),
        content: c.content == null ? null
          : c.base64 ? c.content
          : bytesToBase64(new TextEncoder().encode(c.content)),
      })),
    };
    const res = await this.request("/commit", { method: "POST", body: JSON.stringify(body) });
    for (const f of res.files) {
      if (f.sha) this.shas.set(f.path, f.sha);
      else this.shas.delete(f.path);
    }
    return res;
  }

  async writeFile(path, content, message, { base64 = false } = {}) {
    return this.commit([{ path, content, base64 }], message);
  }

  async deleteFile(path, message) {
    return this.commit([{ path, content: null }], message);
  }

  async latestRun() {
    return this.request("/runs");
  }

  /* ------------------------------------------------------------ backups -- */

  async listBackups() {
    return (await this.request("/backups")).map((b) => ({ ...b, date: new Date(b.date) }));
  }

  async createBackup(kind = "manual") {
    const b = await this.request("/backups", { method: "POST", body: JSON.stringify({ kind }) });
    return { ...b, date: new Date(b.date) };
  }

  async deleteBackup(name) {
    await this.request("/backups/delete", { method: "POST", body: JSON.stringify({ name }) });
  }

  async restoreBackup(name) {
    const r = await this.request("/backups/restore", { method: "POST", body: JSON.stringify({ name }) });
    this.shas.clear();
    return r;
  }

  backupDownloadUrl(name) {
    return `${API}/backups/download?name=${encodeURIComponent(name)}`;
  }
}
