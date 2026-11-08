// CSV with formula-injection protection (OWASP "CSV injection"): a cell that a spreadsheet could read as a formula is prefixed with an apostrophe.
const TRIGGER = /^[=+\-@\t\r\n]/;
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (TRIGGER.test(s) && !(typeof v === "number" && Number.isFinite(v))) s = `'${s}`; // real numbers (even negative) are safe; text that merely looks numeric is not
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Header names are program constants, but they pass through the same escaping. Rows use CRLF; a UTF-8 BOM makes Excel read non-ASCII correctly. */
export const toCsv = (headers: string[], rows: unknown[][]) => "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
