"use client";

import Link from "next/link";

export type TopBarTab = "triage" | "diff" | "lanelet" | "coverage";

const TABS: { id: TopBarTab; href: string; label: string }[] = [
  { id: "triage", href: "/", label: "Triage" },
  { id: "diff", href: "/diff", label: "Diff" },
  { id: "lanelet", href: "/lanelet", label: "Lanelet2" },
  { id: "coverage", href: "/coverage", label: "Coverage" },
];

export default function TopBar({ active }: { active: TopBarTab }) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950 px-5">
      <div className="flex items-center gap-2.5">
        <div className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
        <span className="text-[15px] font-semibold tracking-tight">AV Map Quality Console</span>
      </div>
      <nav className="flex gap-1.5 text-sm" aria-label="Primary">
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-1.5 font-semibold text-indigo-200 shadow-[0_0_0_1px_rgba(99,102,241,0.15)_inset]"
                  : "rounded-md border border-transparent px-3.5 py-1.5 font-medium text-gray-400 hover:border-gray-700 hover:bg-gray-900 hover:text-gray-100"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
