"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LayoutDashboard, RadioTower, ScrollText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme";
import { SPRING } from "@/components/motion";

const LINKS = [
  { href: "/", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard },
  { href: "/logs", label: "Log monitor", short: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[120rem] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background transition-transform group-hover:scale-105">
              <RadioTower className="size-4" />
            </span>
            <span>AV Control</span>
          </Link>
          {/* Top links from tablet width up; phones get the bottom tab bar. */}
          <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Primary">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors pointer-coarse:px-3 pointer-coarse:py-2.5",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span layoutId="nav-active" transition={SPRING} className="absolute inset-0 rounded-md bg-muted" />
                  )}
                  <Icon className="relative size-4" />
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
        aria-label="Primary"
      >
        {LINKS.map(({ href, short, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground transition-colors",
                active && "font-medium text-foreground",
              )}
            >
              <span className="relative rounded-full px-5 py-1">
                {active && (
                  <motion.span layoutId="tab-active" transition={SPRING} className="absolute inset-0 rounded-full bg-muted" />
                )}
                <Icon className="relative size-5" />
              </span>
              {short}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
