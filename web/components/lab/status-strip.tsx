"use client";

import { useEffect, useState } from "react";
import Tag from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface Status {
  live: boolean;
  analyst: string;
  kits: number;
  tracks: number;
}

function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card flex min-w-0 flex-col gap-1.5 px-4 py-3", className)}>
      <span className="caption-style text-subtle whitespace-nowrap">{label}</span>
      <span className="lead-style flex items-center gap-2 font-medium whitespace-nowrap">
        {children}
      </span>
    </div>
  );
}

export default function StatusStrip() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border-border bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4">
      <Stat label="Sandbox">
        {status ? (
          <Tag tone={status.live ? "green" : "neutral"} size="sm">
            {status.live ? "Live" : "Mock only"}
          </Tag>
        ) : (
          <span className="text-faint">…</span>
        )}
      </Stat>
      <Stat label="Analyst">
        {status ? (
          <span className="truncate text-[13px]">{status.analyst}</span>
        ) : (
          <span className="text-faint">…</span>
        )}
      </Stat>
      <Stat label="Kits">
        {status ? status.kits : <span className="text-faint">…</span>}
      </Stat>
      <Stat label="Tracks">
        {status ? status.tracks : <span className="text-faint">…</span>}
      </Stat>
    </div>
  );
}
