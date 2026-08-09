"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { GridIcon, UsersIcon, UserIcon } from "@/components/icons";

const tabs = [
  { href: "/app", label: "My Picks", Icon: GridIcon },
  { href: "/app/standings", label: "Standings", Icon: UsersIcon },
  { href: "/app/account", label: "Account", Icon: UserIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-shell items-stretch">
        {tabs.map(({ href, label, Icon }) => {
          const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "tap-target relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors",
                active ? "text-brand-strong" : "text-ink-mute hover:text-ink-soft",
              )}
            >
              {active ? (
                <span className="absolute top-0 h-0.5 w-9 rounded-full bg-brand-strong" aria-hidden />
              ) : null}
              <Icon className="h-[22px] w-[22px]" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
