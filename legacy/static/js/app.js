/* Router + shell. Hash routing keeps the server a plain static host + JSON API. */
const state = { user: null, unread: 0 };
const root = $("#app");

const NAV = {
  donor: [["dashboard", "🏠", "Dashboard"], ["opportunities", "🩸", "Opportunities"], ["offers", "🤝", "My offers"], ["profile", "👤", "Availability"], ["assistant", "✨", "Assistant"], ["notifications", "🔔", "Alerts"]],
  requester: [["dashboard", "🏠", "Dashboard"], ["requests", "📋", "My requests"], ["requests/new", "➕", "New request"], ["assistant", "✨", "Assistant"], ["notifications", "🔔", "Alerts"]],
  admin: [["admin", "📊", "Analytics"], ["admin/users", "👥", "Users"], ["requests", "📋", "Requests"], ["admin/reports", "🧾", "Reports"], ["assistant", "✨", "Assistant"], ["notifications", "🔔", "Alerts"]],
};

const ROUTES = [ // [regex, roles(null=any signed in), view]
  [/^dashboard$/, null, V.dashboard], [/^profile$/, ["donor"], V.profile], [/^opportunities$/, ["donor"], V.opportunities],
  [/^offers$/, ["donor"], V.offers], [/^requests$/, ["requester", "admin"], V.requests], [/^requests\/new$/, ["requester"], V.newRequest],
  [/^requests\/(\d+)$/, ["requester", "admin"], V.requestDetail], [/^notifications$/, null, V.notifications],
  [/^assistant$/, null, V.assistant], [/^admin$/, ["admin"], V.adminOverview], [/^admin\/users$/, ["admin"], V.adminUsers],
  [/^admin\/reports$/, ["admin"], V.adminReports],
];

async function refreshUser() {
  try { state.user = await api("/auth/me"); } catch { state.user = null; }
}

function shell(path, content) {
  const nav = NAV[state.user.role];
  const link = (n, cls) => {
    const cur = path === n[0] || (n[0] === "requests" && /^requests\/\d+$/.test(path)) || (n[0] === "admin" && path === "admin");
    return h("a", { href: "#/" + n[0], "aria-current": cur ? "page" : null }, h("span", { class: "e", "aria-hidden": "true" }, n[1]), cls ? n[2] : h("span", {}, n[2]),
      n[0] === "notifications" && state.unread ? h("span", { class: "badge-n" }, state.unread) : null);
  };
  return h("div", { class: "shell" },
    h("aside", { class: "side" }, h("a", { class: "brand", href: "#/dashboard" }, h("span", { class: "drop" }), "DonorConnect AI"),
      h("nav", { class: "nav", "aria-label": "Main" }, nav.map((n) => link(n, true))),
      h("div", { style: { marginTop: "auto", padding: "12px" } }, h("div", { class: "sub", style: { color: "#9db0c6" } }, state.user.name, " · ", state.user.role),
        h("button", { class: "btn btn-ghost btn-sm", style: { color: "#fff", borderColor: "#3a557a", marginTop: "8px" }, onclick: logout }, "Sign out"))),
    h("main", { class: "main" }, h("div", { class: "view", id: "view" }, content)),
    h("nav", { class: "bottom", "aria-label": "Mobile" }, nav.slice(0, 5).map((n) => link(n, false))));
}

async function render() {
  const path = (location.hash.replace(/^#\/?/, "") || "").split("?")[0];
  if (!state.user) await refreshUser();
  const pub = { "": V.landing, login: V.login, register: V.register };
  if (path in pub) {
    if (state.user && path !== "") return (location.hash = "#/" + (state.user.role === "admin" ? "admin" : "dashboard"));
    root.replaceChildren(pub[path]()); window.scrollTo(0, 0); return;
  }
  if (!state.user) return (location.hash = "#/login");
  if (path === "dashboard" && state.user.role === "admin") return (location.hash = "#/admin");
  for (const [re, roles, view] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (roles && !roles.includes(state.user.role)) return (location.hash = "#/dashboard");
    root.replaceChildren(shell(path, skeleton()));
    try {
      const n = await api("/notifications"); state.unread = n.unread;
      const content = await view(...m.slice(1));
      root.replaceChildren(shell(path, content));
    } catch (e) {
      if (e.status === 401) { state.user = null; return (location.hash = "#/login"); }
      root.replaceChildren(shell(path, empty(e.message)));
    }
    root.focus({ preventScroll: true }); window.scrollTo(0, 0); return;
  }
  location.hash = "#/dashboard";
}

async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null; location.hash = "#/";
}

window.addEventListener("hashchange", render);
render();
