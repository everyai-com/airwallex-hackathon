export type RunEvent =
  | { type: "chapter"; title: string }
  | { type: "step"; title: string }
  | { type: "info"; message: string }
  | { type: "detail"; label: string; value: string }
  | { type: "decision"; label: string; reason: string };

export interface RunResult {
  ok: boolean;
  mode: "mock" | "live";
  durationMs: number;
  events: RunEvent[];
  error?: string;
}

export function eventToText(event: RunEvent): string {
  switch (event.type) {
    case "chapter":
      return `=== ${event.title} ===`;
    case "step":
      return `-- ${event.title}`;
    case "info":
      return event.message;
    case "detail":
      return `${event.label}: ${event.value}`;
    case "decision":
      return `DECISION ${event.label}: ${event.reason}`;
  }
}
