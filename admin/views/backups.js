/**
 * Backups: make one now, choose the automatic schedule, download, restore or
 * delete. A backup is a git tag in the site's repository on GitHub (see
 * admin/lib/backups.js), so the list here is the repository's own - the same
 * tags show under the repository's Tags on GitHub.
 */
import { el, toast, modal, confirmDialog, plural } from "../lib/dom.js?v=6600ab59";
import { store, commit, watchBuild } from "../store.js?v=6600ab59";
import { KINDS } from "../lib/backups.js?v=6600ab59";

const SETTINGS = "content/settings/backups.json";
const DEFAULTS = { schedule: "daily", keep: 30 };

const fmt = (d) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
function ago(d) {
  const s = (Date.now() - d) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function backupsView() {
  const local = store.backend.mode === "local";
  let settings = { ...DEFAULTS }, saved = JSON.stringify(settings), backups = [];
  const listBox = el("div", { className: "backup-list" }, el("p", { className: "hint" }, "Loading backups…"));
  const summary = el("p", { className: "hint" });

  /* ---------------------------------------------------------- schedule -- */
  const schedule = el("select", { "aria-label": "Automatic backups" },
    el("option", { value: "daily" }, "Every night"),
    el("option", { value: "weekly" }, "Every week (Monday night)"),
    el("option", { value: "off" }, "Off"));
  const keep = el("input", { type: "number", min: "1", max: "365", step: "1", "aria-label": "Automatic backups to keep", style: { width: "80px" } });
  const saveSchedule = el("button", { className: "btn", disabled: true }, "Save schedule");
  const syncSchedule = () => {
    settings = { schedule: schedule.value, keep: Math.max(1, Math.min(365, Math.round(Number(keep.value) || DEFAULTS.keep))) };
    saveSchedule.disabled = JSON.stringify(settings) === saved;
  };
  schedule.onchange = syncSchedule;
  keep.oninput = syncSchedule;
  saveSchedule.onclick = async () => {
    syncSchedule();
    saveSchedule.disabled = true;
    try {
      await commit([{ path: SETTINGS, content: JSON.stringify(settings, null, 2) + "\n" }], "CMS: backup schedule");
      saved = JSON.stringify(settings);
      toast(settings.schedule === "off" ? "Automatic backups are off." : "Backup schedule saved.");
    } catch (err) {
      toast(err.message, "error");
      syncSchedule();
    }
  };

  /* -------------------------------------------------------------- list -- */
  const paint = () => {
    const autos = backups.filter((b) => b.kind === "auto").length;
    summary.textContent = backups.length
      ? `${plural(backups.length, "backup")} · latest ${ago(backups[0].date)}${autos ? ` · ${autos} automatic (the newest ${settings.keep} are kept)` : ""}`
      : "";
    if (!backups.length) {
      listBox.replaceChildren(el("div", { className: "empty" },
        el("p", {}, "No backups yet."),
        el("p", { className: "hint" }, local ? "Back up now to keep a copy of the site's content as it is." : "Back up now, or wait for tonight's automatic backup.")));
      return;
    }
    listBox.replaceChildren(...backups.map((b) => el("div", { className: "backup-row", dataset: { backup: b.name } },
      el("div", { className: "backup-when" },
        el("strong", {}, fmt(b.date)),
        el("span", { className: "muted small" }, `${ago(b.date)} · ${b.name}`)),
      el("span", { className: `badge kind-${b.kind}` }, KINDS[b.kind]),
      el("div", { className: "backup-actions" },
        el("a", { className: "link", href: store.backend.backupDownloadUrl(b.name), target: local ? "_self" : "_blank", rel: "noopener",
          title: local ? "Download the backed-up content as a .zip" : "Download from GitHub as a .zip (you need to be signed in to github.com)" }, "Download"),
        el("button", { className: "link", onclick: () => restore(b) }, "Restore…"),
        el("button", { className: "link danger", onclick: () => remove(b) }, "Delete")))));
  };

  const load = async () => {
    const [s, list] = await Promise.all([
      store.backend.readJson(SETTINGS).catch(() => ({})),
      store.backend.listBackups(),
    ]);
    settings = { ...DEFAULTS, ...s };
    saved = JSON.stringify(settings);
    schedule.value = settings.schedule;
    keep.value = settings.keep;
    saveSchedule.disabled = true;
    backups = list;
    paint();
  };

  const busy = (on, text = "") => {
    nowBtn.disabled = on;
    for (const b of listBox.querySelectorAll("button")) b.disabled = on;
    if (text) toast(text);
  };

  const nowBtn = el("button", { className: "btn primary" }, "Back up now");
  nowBtn.onclick = async () => {
    busy(true);
    nowBtn.textContent = "Backing up\u2026";
    try {
      const b = await store.backend.createBackup("manual");
      toast(`Backed up — ${fmt(b.date)}.`);
      await load();
    } catch (err) {
      toast(`Couldn't back up: ${err.message}`, "error");
    } finally { busy(false); nowBtn.textContent = "Back up now"; }
  };

  async function restore(b) {
    const ok = await modal({
      title: `Restore the backup from ${fmt(b.date)}?`,
      body: el("div", {},
        el("p", {}, "Pages, projects, collections, components, styles, variables, settings, media and fonts go back to how they were then. The site's code isn't touched."),
        el("p", {}, "Before restoring, a backup of how everything is now is made, so you can undo this by restoring that one."),
        local ? el("p", { className: "hint" }, "This changes the files on this computer.") : el("p", { className: "hint" }, "The live site is republished with the restored content.")),
      actions: [{ label: "Cancel", value: null }, { label: "Restore", primary: true, danger: true, value: true }],
    });
    if (!ok) return;
    busy(true, "Backing up the current state…");
    try {
      await store.backend.createBackup("restore");
      const r = await store.backend.restoreBackup(b.name);
      if (r && r.changed === false) {
        toast("Nothing to restore — the content is already the same as in that backup.");
        await load();
        return;
      }
      if (!local) watchBuild("/");
      // Everything the CMS has loaded is from before the restore.
      await confirmDialog("Restored", "The content is back as it was in that backup. The CMS reloads now to show it.", { ok: "Reload" });
      location.reload();
    } catch (err) {
      toast(`Couldn't restore: ${err.message}`, "error");
      busy(false);
    }
  }

  async function remove(b) {
    const ok = await confirmDialog(`Delete the backup from ${fmt(b.date)}?`,
      `It can't be restored after this. ${b.kind === "auto" ? "Automatic backups are also removed on their own once there are more than the number you keep." : ""}`,
      { ok: "Delete", danger: true });
    if (!ok) return;
    busy(true);
    try {
      await store.backend.deleteBackup(b.name);
      toast("Backup deleted.");
      await load();
    } catch (err) {
      toast(`Couldn't delete: ${err.message}`, "error");
    } finally { busy(false); }
  }

  load().catch((err) => listBox.replaceChildren(el("p", { className: "hint" }, `Couldn't load the backups: ${err.message}`)));

  return el("div", { className: "page" },
    el("header", { className: "page-head" },
      el("div", {}, el("h1", {}, "Backups"),
        el("p", { className: "muted" }, "Copies of everything you edit here — pages, projects, collections, components, styles, variables, settings, media and fonts — kept in the site's repository on GitHub. Restore any of them, or download it as a .zip.")),
      el("div", { className: "actions" }, nowBtn)),
    el("section", { className: "card backup-schedule" },
      el("h2", {}, "Automatic backups"),
      el("div", { className: "backup-schedule-row" },
        el("label", {}, "Back up ", schedule),
        el("label", {}, "Keep the last ", keep, " automatic backups"),
        saveSchedule),
      el("p", { className: "hint" }, local
        ? "Automatic backups run on GitHub (at about 03:00 UTC), and only when something changed since the last one. This computer's backups are made with Back up now."
        : "Runs on GitHub at about 03:00 UTC, and only when something changed since the last backup. Manual backups are kept until you delete them.")),
    el("h2", { className: "backup-list-title" }, "All backups"), summary, listBox);
}
