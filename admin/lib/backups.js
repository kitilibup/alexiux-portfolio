/**
 * Backups: what they hold and how they're named. Shared by the CMS (both
 * backends), the local server and the nightly backup workflow
 * (.github/workflows/backup.yml, tools/backup.mjs).
 *
 * A backup is a git tag in the site's (private) source repository:
 *
 *   backup/2026-11-14-0317-auto     made by the nightly workflow
 *   backup/2026-11-14-1802-manual   "Back up now" in the CMS
 *   backup/2026-11-14-1803-restore  made automatically just before a restore
 *
 * so it is exact, permanent, costs nothing to keep and can be downloaded as a
 * .zip from GitHub. Restoring brings back everything the CMS edits - the
 * folders below - and leaves the site's code alone.
 */

/** What a restore puts back: all content, styles, variables, settings, media and fonts. */
export const RESTORE_PATHS = ["content", "assets/img", "assets/uploads", "assets/fonts"];

export const KINDS = {
  auto: "Automatic",
  manual: "Manual",
  restore: "Before a restore",
};

const pad = (n) => String(n).padStart(2, "0");

/** A new backup's tag name, in UTC so names sort by time. */
export function backupName(kind, date = new Date()) {
  if (!KINDS[kind]) throw new Error(`Unknown backup kind: ${kind}`);
  const d = date;
  return `backup/${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${kind}`;
}

/** { name, date, kind } from a tag name, or null if it isn't a backup. */
export function parseBackup(name) {
  const m = String(name).replace(/^refs\/tags\//, "").match(/^backup\/(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)?-(auto|manual|restore)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", kind] = m;
  return { name: m[0], date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), kind };
}

/** Newest first. */
export const sortBackups = (list) => [...list].sort((a, b) => b.date - a.date || b.name.localeCompare(a.name));

/** The automatic backups beyond the newest `keep` (manual ones are kept until deleted). */
export function expired(list, keep) {
  const n = Math.max(1, Number(keep) || 30);
  return sortBackups(list).filter((b) => b.kind === "auto").slice(n);
}

/** Whether the nightly run should make a backup today. */
export function dueToday(schedule, date = new Date()) {
  if (schedule === "daily") return true;
  if (schedule === "weekly") return date.getUTCDay() === 1; // Mondays
  return false;
}
