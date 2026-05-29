"use client";

import { useEffect, useState } from "react";

export const SPLASH_STORAGE_KEY = "avmap-splash-dismissed-v1";

type Tool = {
  name: string;
  description: string;
  dotClass: string;
};

const TOOLS: Tool[] = [
  {
    name: "Triage",
    description: "Tile readiness scoring with a verdict overlay on a live map.",
    dotClass: "bg-indigo-400",
  },
  {
    name: "Diff Review",
    description: "Queue of map change candidates with accept or reject actions.",
    dotClass: "bg-amber-400",
  },
  {
    name: "Lanelet2",
    description: "Synthesised lanelet topology preview with rule based checks.",
    dotClass: "bg-emerald-400",
  },
  {
    name: "Coverage",
    description: "Per city coverage and freshness summaries across the tile set.",
    dotClass: "bg-sky-400",
  },
];

export default function SplashOverlay() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const dismissed = window.localStorage.getItem(SPLASH_STORAGE_KEY);
      if (dismissed !== "true") {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(SPLASH_STORAGE_KEY, "true");
    } catch {
      // localStorage may be unavailable; closing the overlay is still useful.
    }
    setOpen(false);
  }

  if (!mounted || !open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-[640px] rounded-xl border border-gray-800 bg-gray-900 p-6 text-gray-200 shadow-2xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close welcome dialog"
          className="absolute right-3 top-3 rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.28 4.28a.75.75 0 0 1 1.06 0L10 8.94l4.66-4.66a.75.75 0 1 1 1.06 1.06L11.06 10l4.66 4.66a.75.75 0 1 1-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 0 1-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <div className="flex items-center gap-2.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
          <h2
            id="splash-title"
            className="text-lg font-semibold tracking-tight text-gray-100"
          >
            AV Map Quality Console
          </h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          A portfolio demo that explores tooling patterns for autonomous vehicle
          map readiness. Tiles come from real OpenStreetMap data, while readiness
          scores and validator severities are heuristic and synthetic.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${tool.dotClass}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-semibold text-gray-100">
                  {tool.name}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                {tool.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            data-testid="splash-get-started"
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
