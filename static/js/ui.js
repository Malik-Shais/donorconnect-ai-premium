/* Tiny UI toolkit. Text is always set via textContent/text nodes, never innerHTML (XSS-safe). */
const $ = (s, r = document) => r.querySelector(s);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.detail || "Something went wrong";
    if (Array.isArray(msg)) msg = msg.map((e) => (e.msg || "").replace(/^Value error, /, "")).join(". ");
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), 3500);
}

const fmtDate = (s) => (s ? new Date(s.replace(" ", "T") + (s.includes("T") || s.length <= 10 ? "" : "Z")).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");
const pill = (v) => h("span", { class: "pill " + v }, v);
const bgBadge = (g) => h("span", { class: "bg", "aria-label": "Blood group " + g }, g);
const skeleton = (n = 3) => h("div", { class: "list", "aria-busy": "true" }, Array.from({ length: n }, () => h("div", { class: "skeleton" })));
const empty = (t) => h("div", { class: "empty card" }, t);

function field(id, label, input, hint) {
  return h("div", {}, h("label", { for: id }, label), input, hint && h("div", { class: "hint" }, hint), h("div", { class: "err", id: id + "-err", "aria-live": "polite" }));
}
const input = (id, o = {}) => h("input", { id, name: id, ...o });
function select(id, opts, val) {
  const s = h("select", { id, name: id }, opts.map((o) => h("option", { value: o }, o)));
  if (val) s.value = val; return s;
}

/* horizontal bar chart from [{label, value}] */
function bars(items, empty_ = "No data yet") {
  if (!items.length) return h("div", { class: "sub" }, empty_);
  const max = Math.max(...items.map((i) => i.value), 1);
  return h("div", { class: "bars" }, items.map((i) => {
    const fill = h("i"); requestAnimationFrame(() => (fill.style.width = (100 * i.value) / max + "%"));
    fill.style.width = "0%";
    return h("div", { class: "bar" }, h("span", {}, i.label), h("div", { class: "t", role: "img", "aria-label": `${i.label}: ${i.value}` }, fill), h("b", {}, i.value));
  }));
}

/* form helper: collects values, shows server errors, disables button while busy */
async function submitForm(form, btn, fn) {
  btn.disabled = true;
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  try { await fn(); } catch (e) { const g = form.querySelector(".form-err"); if (g) g.textContent = e.message; else toast(e.message, true); }
  finally { btn.disabled = false; }
}
