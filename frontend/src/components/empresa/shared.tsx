import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/pgba-data";

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Metric({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: "success" | "warning" | "default";
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon && (
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground",
              tone === "success" && "bg-success/10 text-success",
              tone === "warning" && "bg-warning/10 text-warning"
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-2 font-display text-2xl font-semibold tabular-nums tracking-tight",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", {
        "bg-success animate-pulse": status === "working",
        "bg-muted-foreground": status === "idle",
        "bg-warning": status === "paused",
      })}
    />
  );
}
