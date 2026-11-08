export const ROLES = ["donor", "requester", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

export type NavItem = { slug: string; label: string; icon: "home" | "heart" | "handshake" | "user" | "list" | "plus" | "sparkles" | "bell" | "users" | "chart" | "file" };
const common: NavItem[] = [{ slug: "assistant", label: "Assistant", icon: "sparkles" }, { slug: "notifications", label: "Alerts", icon: "bell" }];

export const NAV: Record<Role, NavItem[]> = {
  donor: [{ slug: "", label: "Dashboard", icon: "home" }, { slug: "opportunities", label: "Opportunities", icon: "heart" }, { slug: "offers", label: "My offers", icon: "handshake" }, { slug: "availability", label: "Availability", icon: "user" }, ...common],
  requester: [{ slug: "", label: "Dashboard", icon: "home" }, { slug: "requests", label: "My requests", icon: "list" }, { slug: "new-request", label: "New request", icon: "plus" }, ...common],
  admin: [{ slug: "", label: "Analytics", icon: "chart" }, { slug: "users", label: "Users", icon: "users" }, { slug: "requests", label: "Requests", icon: "list" }, { slug: "reports", label: "Reports", icon: "file" }, ...common],
};
