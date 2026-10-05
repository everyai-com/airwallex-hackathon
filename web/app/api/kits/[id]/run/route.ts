import { NextResponse } from "next/server";
import { getKit } from "@/lib/kits";
import { runWebRunner } from "@/lib/runner";
import type { RunResult } from "@/lib/run-types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const kit = getKit(id);
  if (!kit) {
    return NextResponse.json({ error: "Unknown kit" }, { status: 404 });
  }

  let mode: "mock" | "live" = "mock";
  let heuristic = false;
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      heuristic?: unknown;
    };
    if (body.mode === "live" || body.mode === "mock") mode = body.mode;
    heuristic = body.heuristic === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const args = ["run", kit.id, mode === "live" ? "--live" : "--mock"];
  if (heuristic) args.push("--heuristic");

  try {
    const stdout = await runWebRunner(args);
    const result = JSON.parse(stdout) as RunResult;
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut =
      error instanceof Error && "code" in error && error.code === "ETIMEDOUT";
    return NextResponse.json(
      {
        ok: false,
        mode,
        durationMs: 0,
        events: [],
        error: timedOut ? "Run timed out after 5 minutes." : message,
      } satisfies RunResult,
      { status: timedOut ? 504 : 500 },
    );
  }
}
