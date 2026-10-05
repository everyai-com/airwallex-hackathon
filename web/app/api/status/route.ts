import { NextResponse } from "next/server";
import { KIT_GROUPS, KITS } from "@/lib/kits";
import { runWebRunner } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runWebRunner(["status"]);
    const { live, analyst } = JSON.parse(stdout) as {
      live: boolean;
      analyst: string;
    };
    return NextResponse.json({
      live,
      analyst,
      kits: KITS.length,
      tracks: KIT_GROUPS.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
