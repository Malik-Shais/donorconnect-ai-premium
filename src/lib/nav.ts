export const ROLES = ["donor", "requester", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

export type NavItem = { slug: string; label: string; icon: "home" | "heart" | "handshake" | "user" | "list" | "plus" | "sparkles" | "bell" | "users" | "chart" | "file" };
const home = (label = "Dashboard", icon: NavItem["icon"] = "home"): NavItem => ({ slug: "", label, icon });
const alerts: NavItem = { slug: "notifications", label: "Alerts", icon: "bell" };
const profile: NavItem = { slug: "profile", label: "Profile", icon: "user" };
const assistant: NavItem = { slug: "assistant", label: "Assistant", icon: "sparkles" };

// The first five entries form the mobile bottom bar, so they are ordered by importance.
export const NAV: Record<Role, NavItem[]> = {
  donor: [home(), { slug: "opportunities", label: "Opportunities", icon: "heart" }, alerts, profile, assistant, { slug: "offers", label: "My offers", icon: "handshake" }],
  requester: [home(), { slug: "requests", label: "My requests", icon: "list" }, { slug: "new-request", label: "New request", icon: "plus" }, alerts, profile, assistant],
  admin: [home("Analytics", "chart"), { slug: "users", label: "Users", icon: "users" }, { slug: "requests", label: "Requests", icon: "list" }, alerts, profile, { slug: "reports", label: "Reports", icon: "file" }, assistant],
};
