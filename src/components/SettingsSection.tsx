"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SPRING } from "./motion";

/** One titled block of the Settings page; `id` is its anchor for the section nav. */
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-28 rounded-xl border bg-card lg:scroll-mt-20", className)}>
      <header className="flex items-start gap-3 border-b px-4 py-3 sm:px-5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export interface NavSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Jump links to the sections, highlighting the one in view: a sticky column on wide screens,
 * a scrolling strip under the header on phones.
 */
export function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const key = sections.map((s) => s.id).join();

  useEffect(() => {
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [key]);

  const link = (s: NavSection, layoutId: string, className: string) => (
    <a
      key={s.id}
      href={`#${s.id}`}
      onClick={() => setActive(s.id)}
      aria-current={active === s.id ? "location" : undefined}
      className={cn(
        "relative flex shrink-0 items-center gap-2 rounded-md text-sm transition-colors",
        active === s.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {active === s.id && <motion.span layoutId={layoutId} transition={SPRING} className="absolute inset-0 rounded-md bg-muted" />}
      <s.icon className="relative size-4" />
      <span className="relative">{s.label}</span>
    </a>
  );

  return (
    <>
      <nav aria-label="Settings sections" className="sticky top-20 hidden flex-col gap-0.5 self-start lg:flex">
        {sections.map((s) => link(s, "settings-nav", "px-3 py-2"))}
      </nav>
      <nav
        aria-label="Settings sections"
        className="sticky top-14 z-30 -mx-3 flex gap-1 overflow-x-auto border-b bg-background/85 px-3 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden"
      >
        {sections.map((s) => link(s, "settings-strip", "px-2.5 py-1.5"))}
      </nav>
    </>
  );
}
