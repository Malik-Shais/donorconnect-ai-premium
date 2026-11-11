import type { SupabaseClient } from "@supabase/supabase-js";
import { HELP, TOPICS } from "@/lib/ai/knowledge";
import { cleanField } from "@/lib/ai/safety";
import type { Role } from "@/lib/nav";

/** READ-ONLY tools. Properties of this layer:
 *  - every tool runs with the SIGNED-IN USER's Supabase client, so PostgreSQL RLS/permissions decide what is visible (no service key, no raw SQL);
 *  - each tool is bound to roles, enforced here again at execution time (the model could name any tool);
 *  - each returns a fixed WHITELIST of non-sensitive fields: never patient labels, hospitals, names, phones, emails, notes or message text;
 *  - free-text fields (a city typed by a user) are clamped to one short sanitized line. */

type Ctx = { role: Role; supabase: SupabaseClient };
type Tool = { description: string; roles: Role[]; parameters: Record<string, unknown>; run: (a: Record<string, unknown>, c: Ctx) => Promise<unknown> };
const none = { type: "object", properties: {} };
const MAX = 10;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, n = 40) => cleanField(v, n);

const TOOLS: Record<string, Tool> = {
  get_platform_help: {
    description: "Get reviewed help text about how DonorConnect works for the user's role. Use this for 'how do I…' and 'what does … mean' questions.",
    roles: ["donor", "requester", "admin"],
    parameters: { type: "object", properties: { topic: { type: "string", description: "Help topic key" } }, required: ["topic"] },
    run: async (a, { role }) => { const t = HELP[role][String(a.topic)]; return t ? { title: t.title, body: t.body } : { available_topics: TOPICS(role), note: "Unknown topic." }; },
  },
  get_notification_summary: {
    description: "Counts of the user's unread notifications by category. Contains no notification text.",
    roles: ["donor", "requester", "admin"], parameters: none,
    run: async (_a, { supabase }) => {
      const { data, error } = await supabase.from("notifications").select("category,is_read").limit(200);
      if (error) return { unavailable: true };
      const unread: Record<string, number> = {};
      for (const n of data ?? []) if (!n.is_read) unread[String(n.category)] = (unread[String(n.category)] ?? 0) + 1;
      return { unread_total: Object.values(unread).reduce((a, b) => a + b, 0), unread_by_category: unread };
    },
  },
  get_my_opportunities: {
    description: "The signed-in donor's approved, preliminarily matching requests (blood group, units, city, urgency, status). Educational matching only.",
    roles: ["donor"], parameters: none,
    run: async (_a, { supabase }) => {
      const { data, error } = await supabase.rpc("open_requests_for_donor");
      if (error) return { unavailable: true };
      const rows = (data ?? []) as Record<string, unknown>[];
      return { count: rows.length, items: rows.slice(0, MAX).map((r) => ({ request_id: num(r.id), blood_group: str(r.blood_group, 4), units: num(r.units), city: str(r.city), urgency: str(r.urgency, 10), status: str(r.status, 16), in_my_city: Boolean(r.city_match), my_offer_status: r.offer_status ? str(r.offer_status, 12) : null })), note: "Preliminary matching only; hospitals and blood services confirm compatibility." };
    },
  },
  get_my_offers: {
    description: "The signed-in donor's own offers/invitations and whether contact sharing is on for each.",
    roles: ["donor"], parameters: none,
    run: async (_a, { supabase }) => {
      const { data, error } = await supabase.rpc("my_offers");
      if (error) return { unavailable: true };
      const rows = (data ?? []) as Record<string, unknown>[];
      return { count: rows.length, items: rows.slice(0, MAX).map((r) => ({ offer_id: num(r.offer_id), request_id: num(r.request_id), offer_status: str(r.status, 12), contact_sharing_on: Boolean(r.consent_granted), request_status: str(r.request_status, 16), blood_group: str(r.blood_group, 4), units: num(r.units), city: str(r.city), urgency: str(r.urgency, 10) })) };
    },
  },
  get_my_requests: {
    description: "The signed-in requester's OWN blood requests with their current status. No patient or hospital details.",
    roles: ["requester"], parameters: none,
    run: async (_a, { supabase }) => {
      const { data, error } = await supabase.from("blood_requests").select("id,blood_group,units,city,urgency,status,created_at").order("created_at", { ascending: false }).limit(MAX);
      if (error) return { unavailable: true };
      return { count: (data ?? []).length, items: (data ?? []).map((r) => ({ request_id: num(r.id), blood_group: str(r.blood_group, 4), units: num(r.units), city: str(r.city), urgency: str(r.urgency, 10), status: str(r.status, 16), submitted: str(r.created_at, 10) })) };
    },
  },
  get_my_matching_status: {
    description: "For the signed-in requester's own requests: how many donors were invited, accepted, declined or withdrew. Counts only; donors are never identified.",
    roles: ["requester"], parameters: none,
    run: async (_a, { supabase }) => {
      const { data, error } = await supabase.rpc("requester_match_summary");
      if (error) return { unavailable: true };
      const rows = (data ?? []) as Record<string, unknown>[];
      return { count: rows.length, items: rows.slice(0, MAX).map((r) => ({ request_id: num(r.request_id), donors_invited: num(r.invited), donors_accepted: num(r.accepted), donors_declined: num(r.declined), donors_withdrawn: num(r.withdrawn) })) };
    },
  },
  get_operational_stats: {
    description: "Aggregate, non-sensitive operational counts for administrators (requests by status, users by role, pending reviews).",
    roles: ["admin"], parameters: none,
    run: async (_a, { supabase }) => {
      const head = { count: "exact" as const, head: true };
      const req = async (s: string) => (await supabase.from("blood_requests").select("id", head).eq("status", s)).count ?? 0;
      const usr = async (r: string) => (await supabase.from("profiles").select("id", head).eq("role", r)).count ?? 0;
      const [pending_review, approved, matched, fulfilled, rejected, cancelled, donors, requesters] = await Promise.all([req("pending_review"), req("approved"), req("matched"), req("fulfilled"), req("rejected"), req("cancelled"), usr("donor"), usr("requester")]);
      const oldest = await supabase.from("blood_requests").select("created_at").eq("status", "pending_review").order("created_at").limit(1);
      const hours = oldest.data?.[0]?.created_at ? Math.max(0, Math.round((Date.now() - new Date(String(oldest.data[0].created_at)).getTime()) / 3_600_000)) : null;
      return { requests_by_status: { pending_review, approved, matched, fulfilled, rejected, cancelled }, users_by_role: { donors, requesters }, oldest_pending_review_hours: hours };
    },
  },
};

/** Declarations offered to the model: only the tools its role may use. */
export const toolDeclarations = (role: Role) =>
  Object.entries(TOOLS).filter(([, t]) => t.roles.includes(role)).map(([name, t]) => ({ name, description: t.description, parametersJsonSchema: t.parameters }));
export const allowedToolNames = (role: Role) => toolDeclarations(role).map((d) => d.name);

/** Execute a tool the model asked for. Unknown or not-permitted tools are refused with a generic result (the model is not told what exists). */
export async function runTool(name: string, args: unknown, ctx: Ctx): Promise<unknown> {
  const t = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined;
  if (!t || !t.roles.includes(ctx.role)) return { error: "tool_not_available" };
  try {
    const out = await t.run(args && typeof args === "object" ? (args as Record<string, unknown>) : {}, ctx);
    return { untrusted_data: out }; // labelled so the model keeps treating it as data
  } catch { return { error: "tool_failed" }; }
}
