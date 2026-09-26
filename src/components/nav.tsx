"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, RadioTower, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme";

const LINKS = [
  { href: "/", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard },
  { href: "/logs", label: "Log monitor", short: "Logs", icon: ScrollText },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[120rem] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <RadioTower className="size-5" />
            <span>AV Control</span>
          </Link>
          {/* Top links from tablet width up; phones get the bottom tab bar. */}
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted-foreground pointer-coarse:px-3 pointer-coarse:py-2.5 transition-colors hover:bg-muted hover:text-foreground",
                  pathname === href && "bg-muted text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        aria-label="Primary"
      >
        {LINKS.map(({ href, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground transition-colors active:bg-muted",
              pathname === href && "font-medium text-foreground",
            )}
          >
            <span className={cn("rounded-full px-5 py-1 transition-colors", pathname === href && "bg-muted")}>
              <Icon className="size-5" />
            </span>
            {short}
          </Link>
        ))}
      </nav>
    </>
  );
}
