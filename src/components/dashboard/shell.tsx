"use client";
import Link from "@/components/dashboard/link";
import { usePathname } from "next/navigation";
import { Home, HeartPulse, Handshake, UserRound, ListChecks, PlusCircle, Sparkles, Bell, Users, BarChart3, FileText } from "lucide-react";
import { Brand } from "@/components/brand";
import { cn } from "@/lib/utils";
import { NAV, ROLES, type NavItem, type Role } from "@/lib/nav";
import { devNotifications } from "@/lib/dev-data";
import { logoutAction } from "@/app/actions/auth";
import { NotificationsProvider, useNotifications } from "@/components/notifications/provider";

const ICONS = { home: Home, heart: HeartPulse, handshake: Handshake, user: UserRound, list: ListChecks, plus: PlusCircle, sparkles: Sparkles, bell: Bell, users: Users, chart: BarChart3, file: FileText };

type ShellUser = { name: string; email: string };
/** demo=true: fictional data, no auth, role switcher. Otherwise: real signed-in user with sign-out. */
export function DashboardShell({ role, children, demo = false, user, unread: unreadProp = 0 }: { role: Role; children: React.ReactNode; demo?: boolean; user?: ShellUser; unread?: number }) {
  const path = usePathname();
  const base = `${demo ? "/demo" : "/dashboard"}/${role}`;
  const items = NAV[role];
  const href = (i: NavItem) => (i.slug ? `${base}/${i.slug}` : base);
  const current = (i: NavItem) => path === href(i);
  const unread = demo ? devNotifications.length : unreadProp;

  const Role = (
    <nav aria-label="Preview role" className="flex w-fit gap-1 rounded-full bg-white/10 p-1 text-xs">
      {ROLES.map((r) => (
        <Link key={r} href={`/demo/${r}`} aria-current={r === role ? "true" : undefined}
          className={cn("rounded-full px-3 py-1.5 font-semibold capitalize", r === role ? "bg-white text-navy" : "text-slate-300 hover:text-white")}>{r}</Link>
      ))}
    </nav>
  );

  const body = (
    <div className="min-h-dvh md:grid md:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 bg-navy p-4 md:flex">
        <div className="px-2 pb-5 pt-1"><Brand light href="/" /></div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {items.map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.slug} href={href(i)} aria-current={current(i) ? "page" : undefined}
                className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3.5 font-medium transition-colors", current(i) ? "bg-gradient-to-br from-burgundy to-coral-dark text-white" : "text-slate-300 hover:bg-white/10")}>
                <Icon className="size-5" aria-hidden /> {i.label}
                {i.icon === "bell" && <UnreadBadge fallback={unread} />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 p-2">
          {demo ? <><p className="text-xs text-slate-400">Demo role (fictional data)</p>{Role}</> : <Account user={user} profileHref={`${base}/profile`} />}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-col gap-2 bg-navy px-4 py-3 md:hidden">
          <Brand light /> {demo ? Role : <Account user={user} compact profileHref={`${base}/profile`} />}
        </header>
        <main id="main" className="px-4 pb-28 pt-6 md:px-10 md:pb-10 md:pt-9">
          {demo && (
            <p role="note" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <b>Demo mode</b>: fictional data, no account needed. <Link href="/register" className="font-semibold underline">Create a real account</Link>
            </p>
          )}
          {children}
        </main>
        <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-white px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 md:hidden">
          {items.slice(0, 5).map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.slug} href={href(i)} aria-current={current(i) ? "page" : undefined}
                className={cn("relative flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.68rem]", current(i) ? "font-bold text-burgundy" : "text-muted")}>
                <Icon className="size-5" aria-hidden /> {i.label}
                {i.icon === "bell" && <UnreadBadge fallback={unread} className="absolute right-1 top-0 min-w-5 px-1 text-center text-[0.65rem]" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
  return demo ? body : <NotificationsProvider initialUnread={unreadProp}>{body}</NotificationsProvider>;
}

function UnreadBadge({ fallback, className }: { fallback: number; className?: string }) {
  const n = useNotifications(), count = n ? n.unread : fallback;
  return count > 0 ? <span data-testid="unread-badge" aria-label={`${count} unread`} className={cn("rounded-full bg-[#b42318] px-2 text-xs font-bold text-white", className ?? "ml-auto")}>{count}</span> : null;
}

function Account({ user, compact, profileHref }: { user?: ShellUser; compact?: boolean; profileHref?: string }) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "justify-between" : "flex-col items-start")}>
      <p className="min-w-0 truncate text-xs text-slate-300" title={user?.email}>{profileHref ? <Link href={profileHref} className="underline decoration-slate-500 underline-offset-2">{user?.name}</Link> : user?.name}</p>
      <form action={logoutAction}><button className="min-h-9 rounded-full border border-slate-500 px-4 text-sm font-semibold text-white hover:bg-white/10">Sign out</button></form>
    </div>
  );
}
