import { RULES } from "@/lib/validators";

const SEVERITY_DOT: Record<"low" | "med" | "high", string> = {
  low: "bg-green-400",
  med: "bg-yellow-400",
  high: "bg-red-500",
};

export default function RuleLegend() {
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 w-72 rounded border border-gray-800 bg-gray-950/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Validator rules
        </span>
        <span className="text-[10px] text-gray-600">Atlas-Checks style</span>
      </div>
      <ul className="space-y-1.5">
        {RULES.map((r) => (
          <li key={r.id} className="flex items-start gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[r.severity]}`} />
            <div>
              <div className="font-mono text-[10px] text-indigo-300">{r.id}</div>
              <div className="text-[11px] leading-snug text-gray-300">{r.description}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
