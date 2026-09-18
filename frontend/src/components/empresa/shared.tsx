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
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: "success" | "warning" | "default";
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && (
          <span
            className={cn(
              "text-muted-foreground",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning"
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning"
        )}
      >
        {value}
      </p>
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
