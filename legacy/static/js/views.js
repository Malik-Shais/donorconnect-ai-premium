const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const head = (title, ...actions) => h("div", { class: "pagehead" }, h("h1", {}, title), h("div", {}, actions));
const reqRow = (r, extra) => h("a", { class: "card lift item", href: "#/requests/" + r.id, style: { textDecoration: "none", color: "inherit" } },
  h("div", { class: "meta" }, bgBadge(r.blood_group), h("div", {}, h("b", {}, `${r.units} unit${r.units > 1 ? "s" : ""} · ${r.hospital}`), h("div", { class: "sub" }, `${r.city} · ${r.patient_label} · ${fmtDate(r.created_at)}`))),
  h("div", {}, pill(r.urgency), " ", pill(r.status), extra));
const kpi = (n, l) => h("div", { class: "stat" }, h("b", {}, n), h("span", {}, l));

const V = {
  /* ---------- public ---------- */
  landing() {
    const stat = (id, l) => h("div", { class: "stat" }, h("b", { id }, "–"), h("span", {}, l));
    api("/public/stats").then((s) => {
      const set = (id, v) => { const e = $("#" + id); if (e) e.textContent = v; };
      set("s-donors", s.donors); set("s-avail", s.available); set("s-req", s.requests); set("s-ful", s.fulfilled); set("s-city", s.cities);
    }).catch(() => {});
    const step = (n, t, d) => h("div", { class: "card lift reveal", style: { animationDelay: n * 0.1 + "s" } }, h("div", { class: "ico" }, n), h("h3", {}, t), h("p", { class: "sub" }, d));
    const feat = (i, t, d) => h("div", { class: "card lift" }, h("div", { class: "ico", "aria-hidden": "true" }, i), h("h3", {}, t), h("p", { class: "sub" }, d));
    return h("div", {},
      h("header", { class: "topbar" }, h("div", { class: "wrap" }, h("a", { class: "brand", href: "#/" }, h("span", { class: "drop" }), "DonorConnect AI"),
        h("div", { style: { display: "flex", gap: "8px" } }, h("a", { class: "btn btn-ghost btn-sm", href: "#/login" }, "Sign in"), h("a", { class: "btn btn-primary btn-sm", href: "#/register" }, "Join free")))),
      h("section", { class: "hero" }, h("div", { class: "wrap" },
        h("div", { class: "reveal" }, h("span", { class: "eyebrow" }, "Blood donor coordination · privacy first"),
          h("h1", {}, "Right donor. Right place. Right time."),
          h("p", { class: "lead" }, "DonorConnect AI links people who need blood with willing, nearby, compatible donors, and only shares contact details when a donor says yes."),
          h("div", { class: "cta" }, h("a", { class: "btn btn-primary", href: "#/register" }, "Become a donor"), h("a", { class: "btn btn-ghost", href: "#/register" }, "Request blood"))),
        h("div", { class: "pulse", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("div", { class: "big" })))),
      h("div", { class: "wrap" }, h("div", { class: "stats", "aria-label": "Live platform statistics" },
        stat("s-donors", "Registered donors"), stat("s-avail", "Available now"), stat("s-req", "Requests posted"), stat("s-ful", "Fulfilled"), stat("s-city", "Cities"))),
      h("section", { class: "block" }, h("div", { class: "wrap" }, h("h2", {}, "How it works"),
        h("div", { class: "grid g3" }, step(1, "Register", "Donors add blood group, city and availability. Requesters sign up in a minute."),
          step(2, "Match", "Preliminary blood-group and city matching ranks the best available, eligible donors."),
          step(3, "Consent & connect", "Donors choose, per request, whether to share contact details. Track every status update.")))),
      h("section", { class: "block", style: { paddingTop: 0 } }, h("div", { class: "wrap" }, h("h2", {}, "Built for trust"),
        h("div", { class: "grid g3" }, feat("🔒", "Consent-based contact", "Phone and email stay hidden until a donor opts in for a specific request."),
          feat("📍", "Location-aware", "Same-city donors rank first and get in-app alerts for urgent needs."),
          feat("📈", "Real analytics", "Supply vs demand by blood group, fulfilment rates and exportable reports."),
          feat("✨", "Safe AI assistant", "Answers donation and app questions. Never diagnoses or advises on transfusions."),
          feat("⏱️", "Eligibility aware", "Donors are paused automatically after a donation interval."),
          feat("📱", "Mobile first", "Fast, accessible, works on any phone with no app install.")))),
      h("section", { class: "block", style: { paddingTop: 0 } }, h("div", { class: "wrap" }, h("div", { class: "safety" },
        h("h2", {}, "A coordination tool, not a clinic"),
        h("p", {}, "Matching here is preliminary. DonorConnect AI does not provide medical diagnoses or transfusion decisions. Hospitals and blood banks always confirm compatibility, screening and eligibility. In an emergency, contact local emergency services.")))),
      h("footer", { class: "site" }, h("div", { class: "wrap" }, "© DonorConnect AI Premium · Demonstration software · Demo data is fictional.")));
  },

  login() {
    const err = h("div", { class: "err form-err", role: "alert" });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Sign in");
    const form = h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submitForm(form, btn, async () => {
      state.user = await api("/auth/login", { method: "POST", body: { email: form.email.value, password: form.password.value } });
      location.hash = state.user.role === "admin" ? "#/admin" : "#/dashboard"; }); } },
      field("email", "Email", input("email", { type: "email", autocomplete: "username", required: true })),
      field("password", "Password", input("password", { type: "password", autocomplete: "current-password", required: true })), err, btn);
    return V.authBox("Welcome back", form, h("p", { class: "sub" }, "New here? ", h("a", { href: "#/register" }, "Create an account")));
  },

  register() {
    const role = select("role", ["donor", "requester"]);
    const bg = select("blood_group", GROUPS);
    const bgWrap = field("blood_group", "Blood group", bg, "Required for donors. Final group is always confirmed by a lab.");
    role.addEventListener("change", () => (bgWrap.style.display = role.value === "donor" ? "" : "none"));
    const err = h("div", { class: "err form-err", role: "alert" });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Create account");
    const terms = input("accept_terms", { type: "checkbox" });
    const form = h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submitForm(form, btn, async () => {
      const v = (n) => form[n].value;
      state.user = await api("/auth/register", { method: "POST", body: { name: v("name"), email: v("email"), password: v("password"), role: v("role"),
        city: v("city"), phone: v("phone") || null, blood_group: v("role") === "donor" ? v("blood_group") : null, accept_terms: terms.checked } });
      location.hash = "#/dashboard"; }); } },
      field("role", "I want to", role, "Donate blood (donor) or request blood (requester)."),
      field("name", "Full name", input("name", { autocomplete: "name", required: true, maxlength: 60 })),
      h("div", { class: "row2" }, field("email", "Email", input("email", { type: "email", autocomplete: "email", required: true })), field("city", "City", input("city", { autocomplete: "address-level2", required: true }))),
      h("div", { class: "row2" }, field("password", "Password", input("password", { type: "password", autocomplete: "new-password", minlength: 8, required: true }), "8+ characters with a letter and a number."), field("phone", "Phone (optional)", input("phone", { type: "tel", autocomplete: "tel" }), "Only shared if you consent.")),
      bgWrap, h("div", { class: "check" }, terms, h("label", { for: "accept_terms" }, "I am 18 or older and understand this tool gives no medical advice.")), err, btn);
    return V.authBox("Join DonorConnect", form, h("p", { class: "sub" }, "Already registered? ", h("a", { href: "#/login" }, "Sign in")));
  },

  authBox(title, form, foot) {
    return h("div", {}, h("header", { class: "topbar" }, h("div", { class: "wrap" }, h("a", { class: "brand", href: "#/" }, h("span", { class: "drop" }), "DonorConnect AI"))),
      h("div", { class: "authbox view" }, h("div", { class: "card" }, h("h1", { style: { fontSize: "1.8rem" } }, title), form, foot)));
  },

  /* ---------- shared ---------- */
  async dashboard() {
    return state.user.role === "donor" ? V.donorDash() : V.requesterDash();
  },

  async donorDash() {
    const [p, opp, offers, sd] = await Promise.all([api("/donor/profile"), api("/donor/opportunities"), api("/donor/offers"), api("/analytics/supply-demand")]);
    const mine = sd.find((s) => p.can_give_to.includes(s.blood_group));
    const demand = sd.filter((s) => s.open_units > 0).map((s) => ({ label: s.blood_group, value: s.open_units }));
    return h("div", {}, head(`Hello, ${p.name.split(" ")[0]}`, h("a", { class: "btn btn-primary btn-sm", href: "#/opportunities" }, "See opportunities")),
      h("div", { class: "kpis" }, kpi(p.blood_group, "Your blood group"), kpi(p.available && p.eligible ? "Active" : "Paused", "Matching status"),
        kpi(opp.items.length, "Requests you could help"), kpi(offers.filter((o) => o.status === "accepted").length, "Offers accepted")),
      !p.eligible && h("div", { class: "notice", style: { marginBottom: "18px" } }, `You're resting until ${fmtDate(p.next_eligible)} (standard interval). Matching resumes automatically.`),
      h("div", { class: "grid g2" },
        h("div", { class: "card" }, h("h3", {}, "Open demand (units)"), bars(demand, "No open requests right now")),
        h("div", { class: "card" }, h("h3", {}, "Your compatibility"), h("p", { class: "sub" }, "Preliminary red-cell guide:"),
          h("p", {}, h("b", {}, "Can give to: "), p.can_give_to.join(", ")), h("p", {}, h("b", {}, "Can receive from: "), p.can_receive_from.join(", ")),
          h("a", { href: "#/profile" }, "Update availability →"))));
  },

  async requesterDash() {
    const [list, sd] = await Promise.all([api("/requests"), api("/analytics/supply-demand")]);
    const c = (s) => list.filter((r) => r.status === s).length;
    return h("div", {}, head(`Hello, ${state.user.name.split(" ")[0]}`, h("a", { class: "btn btn-primary btn-sm", href: "#/requests/new" }, "New request")),
      h("div", { class: "kpis" }, kpi(c("open"), "Open"), kpi(c("matched"), "Matched"), kpi(c("fulfilled"), "Fulfilled"), kpi(list.reduce((a, r) => a + r.accepted, 0), "Donors accepted")),
      h("div", { class: "grid g2" },
        h("div", { class: "card" }, h("h3", {}, "Recent requests"), list.length ? h("div", { class: "list" }, list.slice(0, 4).map((r) => reqRow(r))) : h("p", { class: "sub" }, "No requests yet.")),
        h("div", { class: "card" }, h("h3", {}, "Compatible donors available"), h("p", { class: "sub" }, "Available donors who could preliminarily give to each group, platform-wide."),
          bars(sd.map((s) => ({ label: s.blood_group, value: s.compatible_donors })), "No data"))));
  },

  /* ---------- donor ---------- */
  async profile() {
    const p = await api("/donor/profile");
    const avail = input("available", { type: "checkbox", role: "switch" }); avail.checked = p.available;
    const bg = select("blood_group", GROUPS, p.blood_group);
    const err = h("div", { class: "err form-err", role: "alert" });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Save changes");
    const form = h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submitForm(form, btn, async () => {
      await api("/donor/profile", { method: "PUT", body: { blood_group: bg.value, city: form.city.value, phone: form.phone.value || null, available: avail.checked, last_donation: form.last_donation.value || null } });
      toast("Profile saved"); render(); }); } },
      h("div", { class: "item" }, h("div", {}, h("b", {}, "Available to donate"), h("div", { class: "sub" }, "Turn off to stop receiving matches.")), h("label", { class: "toggle" }, avail, h("span"), h("span", { class: "sr", style: { display: "none" } }, "Available"))),
      field("blood_group", "Blood group", bg),
      h("div", { class: "row2" }, field("city", "City", input("city", { value: p.city, required: true })), field("phone", "Phone", input("phone", { type: "tel", value: p.phone || "" }), "Hidden unless you consent per request.")),
      field("last_donation", "Last donation date", input("last_donation", { type: "date", value: p.last_donation || "", max: new Date().toISOString().slice(0, 10) }), p.next_eligible ? `Next eligible: ${fmtDate(p.next_eligible)}` : "Leave empty if you have never donated."), err, btn);
    return h("div", {}, head("Availability & profile"), h("div", { class: "card", style: { maxWidth: "620px" } }, form));
  },

  async opportunities() {
    const { paused, items } = await api("/donor/opportunities");
    const body = paused ? h("div", { class: "notice" }, "Matching is paused (you're unavailable or resting after a recent donation). Update your ", h("a", { href: "#/profile" }, "availability"), ".")
      : items.length ? h("div", { class: "list" }, items.map(V.oppCard)) : empty("No compatible open requests right now. We'll notify you.");
    return h("div", {}, head("Opportunities"), h("p", { class: "sub" }, "Preliminary matches by blood group and city. Hospitals confirm final compatibility."), body);
  },

  oppCard(r) {
    const share = input("share" + r.id, { type: "checkbox" });
    const btn = h("button", { class: "btn btn-primary btn-sm", disabled: !!r.my_offer }, r.my_offer ? "Responded" : "I can help");
    btn.addEventListener("click", async () => { btn.disabled = true; try { await api(`/donor/requests/${r.id}/respond`, { method: "POST", body: { share_contact: share.checked } }); toast("Thank you! The requester was notified."); render(); } catch (e) { toast(e.message, true); btn.disabled = false; } });
    return h("div", { class: "card" }, h("div", { class: "item" }, h("div", { class: "meta" }, bgBadge(r.blood_group), h("div", {}, h("b", {}, `${r.units} unit${r.units > 1 ? "s" : ""} · ${r.hospital}`), h("div", { class: "sub" }, `${r.city}${r.city_match ? " · your city" : ""}${r.needed_by ? " · needed by " + fmtDate(r.needed_by) : ""}`))), h("div", {}, pill(r.urgency), " ", pill(r.status))),
      !r.my_offer && h("div", { class: "item", style: { marginTop: "14px" } }, h("div", { class: "check" }, share, h("label", { for: "share" + r.id }, "Share my phone & email with this requester")), btn));
  },

  async offers() {
    const list = await api("/donor/offers");
    const act = (o, action) => async () => {
      const share = action === "accept" && $("#sc" + o.id).checked;
      try { await api(`/donor/offers/${o.id}/respond`, { method: "POST", body: { action, share_contact: share } }); toast(action === "accept" ? "Accepted. Thank you!" : "Declined"); render(); } catch (e) { toast(e.message, true); }
    };
    return h("div", {}, head("My offers"), list.length ? h("div", { class: "list" }, list.map((o) => h("div", { class: "card" },
      h("div", { class: "item" }, h("div", { class: "meta" }, bgBadge(o.blood_group), h("div", {}, h("b", {}, `${o.hospital}, ${o.city}`), h("div", { class: "sub" }, `${o.origin === "invited" ? "Invited" : "You volunteered"} · ${fmtDate(o.created_at)}`))), h("div", {}, pill(o.status), " ", pill(o.request_status))),
      o.status === "invited" && o.request_status !== "fulfilled" && o.request_status !== "cancelled" && h("div", { class: "item", style: { marginTop: "14px" } },
        h("div", { class: "check" }, input("sc" + o.id, { type: "checkbox" }), h("label", { for: "sc" + o.id }, "Share my contact details if I accept")),
        h("div", {}, h("button", { class: "btn btn-primary btn-sm", onclick: act(o, "accept") }, "Accept"), " ", h("button", { class: "btn btn-ghost btn-sm", onclick: act(o, "decline") }, "Decline"))),
      o.status === "accepted" && h("p", { class: "sub", style: { marginTop: "10px" } }, o.share_contact ? "✓ Contact shared with requester." : "Your contact details are private."))))
      : empty("No offers yet. Visit Opportunities to help."));
  },

  /* ---------- requester ---------- */
  async requests() {
    const list = await api("/requests");
    return h("div", {}, head(state.user.role === "admin" ? "All requests" : "My requests", state.user.role === "requester" && h("a", { class: "btn btn-primary btn-sm", href: "#/requests/new" }, "New request")),
      list.length ? h("div", { class: "list" }, list.map((r) => reqRow(r, r.accepted ? h("span", { class: "sub" }, ` · ${r.accepted} accepted`) : null))) : empty("No requests yet."));
  },

  newRequest() {
    const err = h("div", { class: "err form-err", role: "alert" });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Post request");
    const form = h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submitForm(form, btn, async () => {
      const v = (n) => form[n].value;
      const r = await api("/requests", { method: "POST", body: { patient_label: v("patient_label"), blood_group: v("blood_group"), units: +v("units"), city: v("city"), hospital: v("hospital"), urgency: v("urgency"), needed_by: v("needed_by") || null, note: v("note") || null } });
      toast("Request posted"); location.hash = "#/requests/" + r.id; }); } },
      h("div", { class: "notice" }, "Use initials or an alias for the patient. Don't enter diagnoses or medical records."),
      h("div", { class: "row2" }, field("patient_label", "Patient alias / initials", input("patient_label", { required: true, maxlength: 40 })), field("blood_group", "Blood group needed", select("blood_group", GROUPS))),
      h("div", { class: "row2" }, field("units", "Units", input("units", { type: "number", min: 1, max: 10, value: 1, required: true })), field("urgency", "Urgency", select("urgency", ["routine", "urgent", "critical"], "urgent"))),
      h("div", { class: "row2" }, field("city", "City", input("city", { value: state.user.city, required: true })), field("hospital", "Hospital / blood bank", input("hospital", { required: true, maxlength: 100 }))),
      field("needed_by", "Needed by (optional)", input("needed_by", { type: "date", min: new Date().toISOString().slice(0, 10) })),
      field("note", "Note for donors (optional)", h("textarea", { id: "note", name: "note", rows: 3, maxlength: 300 })), err, btn);
    return h("div", {}, head("New blood request"), h("div", { class: "card", style: { maxWidth: "680px" } }, form));
  },

  async requestDetail(id) {
    const d = await api("/requests/" + id);
    const r = d.request, mine = state.user.role === "requester" && ["open", "matched"].includes(r.status);
    const invite = (m) => async (e) => { e.target.disabled = true; try { await api(`/requests/${id}/invite`, { method: "POST", body: { donor_id: m.donor_id } }); toast("Invitation sent"); render(); } catch (x) { toast(x.message, true); e.target.disabled = false; } };
    const close = (status) => async () => { if (!confirm(`Mark this request as ${status}?`)) return; try { await api(`/requests/${id}/status`, { method: "PATCH", body: { status } }); toast("Updated"); render(); } catch (x) { toast(x.message, true); } };
    return h("div", {}, head(`${r.blood_group} · ${r.hospital}`, mine && h("span", {}, h("button", { class: "btn btn-teal btn-sm", onclick: close("fulfilled") }, "Mark fulfilled"), " ", h("button", { class: "btn btn-ghost btn-sm", onclick: close("cancelled") }, "Cancel request"))),
      h("div", { class: "card", style: { marginBottom: "18px" } }, h("div", { class: "item" }, h("div", { class: "meta" }, bgBadge(r.blood_group), h("div", {}, h("b", {}, `${r.units} unit(s) · ${r.city}`), h("div", { class: "sub" }, `${r.patient_label} · posted ${fmtDate(r.created_at)}${r.needed_by ? " · needed by " + fmtDate(r.needed_by) : ""}`))), h("div", {}, pill(r.urgency), " ", pill(r.status))), r.note && h("p", { style: { marginTop: "12px" } }, r.note)),
      h("div", { class: "grid g2" },
        h("div", { class: "card" }, h("h3", {}, "Donor responses"), d.offers.length ? h("div", { class: "list" }, d.offers.map((o) => h("div", {}, h("div", { class: "item" }, h("div", { class: "meta" }, bgBadge(o.blood_group), h("div", {}, h("b", {}, o.name), h("div", { class: "sub" }, o.origin))), pill(o.status)),
          o.contact_shared ? h("div", { class: "notice", style: { marginTop: "8px", background: "#e9f7ee", borderColor: "#bfe6cd", color: "#175c3a" } }, "Shared with consent: ", o.phone || "no phone", " · ", o.email)
            : o.status === "accepted" ? h("div", { class: "sub", style: { marginTop: "6px" } }, "Donor chose not to share contact details.") : null))) : h("p", { class: "sub" }, "No responses yet.")),
        h("div", { class: "card" }, h("h3", {}, "Timeline"), h("ul", { class: "timeline" }, d.events.map((e) => h("li", {}, h("b", {}, e.status), " · ", fmtDate(e.created_at), e.note && h("div", { class: "sub" }, e.note)))))),
      mine && h("div", { class: "card", style: { marginTop: "18px" } }, h("h3", {}, "Suggested donors"), h("p", { class: "sub" }, "Preliminary matches: available, eligible and compatible. Names are abbreviated; contact is shared only if a donor accepts and consents."),
        d.matches.length ? h("div", { class: "list" }, d.matches.map((m) => h("div", { class: "item" }, h("div", { class: "meta" }, bgBadge(m.blood_group), h("div", {}, h("b", {}, m.display), h("div", { class: "sub" }, `${m.city}${m.same_city ? " · same city" : ""} · score ${m.score}`))),
          state.user.role === "requester" && h("button", { class: "btn btn-primary btn-sm", onclick: invite(m) }, "Invite")))) : h("p", { class: "sub" }, "No further matches right now.")));
  },

  /* ---------- notifications & AI ---------- */
  async notifications() {
    const n = await api("/notifications");
    if (n.unread) { await api("/notifications/read", { method: "POST" }); state.unread = 0; }
    return h("div", {}, head("Notifications"), n.items.length ? h("div", { class: "list" }, n.items.map((i) => h(i.link ? "a" : "div", { class: "card lift item", href: i.link, style: { textDecoration: "none", color: "inherit", borderLeft: i.is_read ? "" : "4px solid var(--coral)" } }, h("span", {}, i.message), h("span", { class: "sub" }, fmtDate(i.created_at))))) : empty("You're all caught up."));
  },

  async assistant() {
    const st = await api("/ai/status");
    const log = h("div", { class: "chat", "aria-live": "polite" }, h("div", { class: "msg bot" }, "Hi! Ask me about blood-group compatibility, donation intervals, preparing to donate, consent or how DonorConnect works. I can't give medical advice."));
    const box = input("q", { placeholder: "Ask a question…", maxlength: 1000, autocomplete: "off", "aria-label": "Your question" });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Send");
    const ask = async (text) => {
      if (!text.trim()) return;
      log.append(h("div", { class: "msg me" }, text)); const wait = h("div", { class: "msg bot" }, "…"); log.append(wait); log.scrollTop = log.scrollHeight; btn.disabled = true;
      try { const r = await api("/ai/chat", { method: "POST", body: { message: text } }); wait.textContent = r.reply; wait.append(h("div", { class: "sub", style: { marginTop: "6px" } }, `${r.disclaimer} (${r.source})`)); }
      catch (e) { wait.textContent = e.message; } finally { btn.disabled = false; log.scrollTop = log.scrollHeight; }
    };
    const form = h("form", { class: "item", style: { flexWrap: "nowrap", marginTop: "12px" }, onsubmit: (e) => { e.preventDefault(); const t = box.value; box.value = ""; ask(t); } }, h("div", { style: { flex: 1 } }, box), btn);
    const chips = ["Who can an O- donor give to?", "How often can I donate?", "How is my contact info protected?", "How does matching work?"];
    return h("div", {}, head("AI assistant"), h("div", { class: "card", style: { maxWidth: "720px" } },
      h("div", { class: "notice" }, "General information only. No diagnoses or transfusion decisions. ", st.live ? "Live AI is on." : "Offline mode (add GEMINI_API_KEY for live AI)."),
      h("div", { class: "chips" }, chips.map((c) => h("button", { class: "chip", type: "button", onclick: () => ask(c) }, c))), log, form));
  },

  /* ---------- admin ---------- */
  async adminOverview() {
    const o = await api("/admin/overview"); const u = Object.fromEntries(o.users.map((x) => [x.role, x.n]));
    const lab = (rows, k) => rows.map((r) => ({ label: r[k], value: r.n }));
    const days = o.per_day, max = Math.max(1, ...days.map((d) => d.n));
    return h("div", {}, head("Analytics"),
      h("div", { class: "kpis" }, kpi(u.donor || 0, "Donors"), kpi(u.requester || 0, "Requesters"), kpi(o.totals.available_donors, "Available donors"), kpi(o.totals.requests, "Requests"), kpi(o.totals.fulfilment_rate + "%", "Fulfilment rate"), kpi(o.totals.acceptances, "Donor acceptances")),
      h("div", { class: "grid g2" },
        h("div", { class: "card" }, h("h3", {}, "Requests by status"), bars(lab(o.by_status, "status"))),
        h("div", { class: "card" }, h("h3", {}, "Requests by urgency"), bars(lab(o.by_urgency, "urgency"))),
        h("div", { class: "card" }, h("h3", {}, "Demand by blood group"), bars(lab(o.by_group, "blood_group"))),
        h("div", { class: "card" }, h("h3", {}, "Donors by blood group"), bars(lab(o.donors_by_group, "blood_group"))),
        h("div", { class: "card" }, h("h3", {}, "Top cities (requests)"), bars(lab(o.top_cities, "city"))),
        h("div", { class: "card" }, h("h3", {}, "Requests, last 14 days"), days.length ? h("div", { class: "cols", role: "img", "aria-label": "Requests per day" }, days.map((d) => h("div", { title: `${d.day}: ${d.n}`, style: { height: (100 * d.n) / max + "%" } }))) : h("p", { class: "sub" }, "No recent requests."))));
  },

  async adminUsers() {
    const holder = h("div", {}); const q = input("q", { type: "search", placeholder: "Search name, email or city", "aria-label": "Search users" });
    const load = async () => {
      const rows = await api("/admin/users?q=" + encodeURIComponent(q.value));
      holder.replaceChildren(h("div", { class: "card tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Name", "Email", "Role", "City", "Status", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map((u) => h("tr", {}, h("td", {}, u.name), h("td", {}, u.email), h("td", {}, pill(u.role)), h("td", {}, u.city), h("td", {}, u.active ? "Active" : "Disabled"),
          h("td", {}, u.id !== state.user.id && h("button", { class: "btn btn-ghost btn-sm", onclick: async () => { try { await api("/admin/users/" + u.id, { method: "PATCH", body: { active: !u.active } }); load(); } catch (e) { toast(e.message, true); } } }, u.active ? "Disable" : "Enable"))))))));
    };
    let t; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); }); await load();
    return h("div", {}, head("Users"), h("div", { style: { marginBottom: "14px", maxWidth: "380px" } }, q), holder);
  },

  async adminReports() {
    const sd = await api("/analytics/supply-demand");
    return h("div", {}, head("Reports", h("a", { class: "btn btn-primary btn-sm", href: "/api/admin/reports/requests.csv", download: true }, "Download requests CSV")),
      h("div", { class: "card tablewrap" }, h("h3", {}, "Supply vs demand"), h("table", {}, h("thead", {}, h("tr", {}, ["Blood group", "Compatible available donors", "Open units needed", "Coverage"].map((t) => h("th", {}, t)))),
        h("tbody", {}, sd.map((s) => h("tr", {}, h("td", {}, bgBadge(s.blood_group)), h("td", {}, s.compatible_donors), h("td", {}, s.open_units), h("td", {}, s.open_units === 0 ? "No open demand" : s.compatible_donors >= s.open_units ? "Adequate" : "Shortfall")))))));
  },
};
