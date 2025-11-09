import { BIAS_ALERT_THRESHOLD } from "@/lib/bias";

interface BiasLegendProps {
  className?: string;
}

export default function BiasLegend({ className }: BiasLegendProps) {
  const baseClasses =
    "flex flex-wrap items-center gap-3 text-[0.65rem] uppercase tracking-[0.35em] text-zinc-400";

  return (
    <div className={`${baseClasses}${className ? ` ${className}` : ""}`}>
      <span className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/15 px-3 py-1 text-purple-100">
        <span className="h-2.5 w-2.5 rounded-full bg-purple-300" />
        Biased &lt; {BIAS_ALERT_THRESHOLD.toFixed(1)}
      </span>
      <span className="inline-flex items-center gap-2 rounded-full border border-orange-800/30 bg-orange-800/10 px-3 py-1 text-orange-100">
        <span className="h-2.5 w-2.5 rounded-full bg-orange-300" />
        Normal range
      </span>
    </div>
  );
}
