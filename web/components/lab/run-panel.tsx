"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/button";
import Tag from "@/components/ui/tag";
import RunEvents from "@/components/lab/run-events";
import { PlayIcon } from "@/components/lab/icons";
import { cn } from "@/lib/utils";
import { eventToText, type RunEvent, type RunResult } from "@/lib/run-types";

function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, [running]);
  return elapsed;
}

export default function RunPanel({
  kitId,
  supportsHeuristic,
}: {
  kitId: string;
  supportsHeuristic: boolean;
}) {
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const [heuristic, setHeuristic] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const elapsed = useElapsed(running);
  const runId = useRef(0);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { live?: boolean } | null) =>
        setLiveAvailable(data?.live ?? false),
      )
      .catch(() => setLiveAvailable(false));
  }, []);

  async function run() {
    const id = ++runId.current;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/kits/${kitId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, heuristic }),
      });
      const data = (await res.json()) as RunResult;
      if (runId.current === id) setResult(data);
    } catch (error) {
      if (runId.current === id) {
        setResult({
          ok: false,
          mode,
          durationMs: 0,
          events: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (runId.current === id) setRunning(false);
    }
  }

  const chapters = result?.events.filter((e) => e.type === "chapter").length ?? 0;
  const decisions =
    result?.events.filter((e) => e.type === "decision").length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <div className="border-line-strong bg-secondary flex rounded-full border p-0.5">
          {(["mock", "live"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              disabled={option === "live" && liveAvailable === false}
              aria-pressed={mode === option}
              className={cn(
                "ease-power3-out cursor-pointer rounded-full px-3 py-1.5 text-[12px] leading-none font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
                mode === option
                  ? "bg-muted text-foreground shadow-[inset_0px_1px_0px_0px_rgba(255,255,255,0.1),inset_0px_0px_0px_1px_rgba(255,255,255,0.06)]"
                  : "text-subtle hover:text-foreground",
              )}
            >
              {option === "mock" ? "Mock" : "Live"}
            </button>
          ))}
        </div>

        {supportsHeuristic && (
          <label className="caption-style text-subtle flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={heuristic}
              onChange={(e) => setHeuristic(e.target.checked)}
              className="border-line-strong bg-secondary size-3.5 accent-[#4124fb]"
            />
            Deterministic analyst
          </label>
        )}

        <div className="ms-auto flex items-center gap-2">
          {running && (
            <span className="caption-style text-subtle tabular-nums">
              {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={run}
            disabled={running}
            className="min-w-24"
          >
            {running ? (
              <>
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" strokeLinecap="round" />
                </svg>
                Running
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                Run {mode === "mock" ? "mock" : "live"}
              </>
            )}
          </Button>
        </div>
      </div>

      {liveAvailable === false && mode === "live" && (
        <p className="caption-style text-warning px-1">
          Live mode is disabled — no sandbox keys in .env. Add AWX_CLIENT_ID and
          AWX_API_KEY, or run in mock mode.
        </p>
      )}

      {result && (
        <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={result.ok ? "green" : "red"} size="sm">
              {result.ok ? "Passed" : "Failed"}
            </Tag>
            <Tag tone="neutral" size="sm">
              {result.mode}
            </Tag>
            <span className="caption-style text-subtle">
              {(result.durationMs / 1000).toFixed(1)}s · {chapters} chapters ·{" "}
              {decisions} decisions
            </span>
          </div>

          {result.error && (
            <p className="text-danger text-[13px] leading-snug">{result.error}</p>
          )}

          {result.events.length > 0 && <RunEvents events={result.events} />}

          <details className="group">
            <summary className="caption-style text-subtle ease-power3-out cursor-pointer list-none transition-colors duration-150 select-none hover:text-foreground">
              <span className="group-open:hidden">Show raw log</span>
              <span className="hidden group-open:inline">Hide raw log</span>
            </summary>
            <pre className="border-border bg-secondary mt-2 max-h-96 overflow-auto rounded-lg border p-3 font-mono text-[12px] leading-relaxed text-soft">
              {result.events.map(eventToText).join("\n")}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}

export type { RunEvent };
