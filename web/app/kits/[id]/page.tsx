import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Button from "@/components/ui/button";
import Tag from "@/components/ui/tag";
import PageHeader from "@/components/lab/page-header";
import RunPanel from "@/components/lab/run-panel";
import Shell from "@/components/lab/shell";
import { KIT_GROUPS, KITS, getKit } from "@/lib/kits";

const ACCESS_NOTES: Record<string, string> = {
  Sandbox: "Live with sandbox keys, or mock with none.",
  Platform: "Needs connected accounts + platform payments; mock until enabled.",
  Airi: "Needs Airi CLI allowlist; mock until enabled.",
  Merchant: "Needs merchant-side commerce; mock until enabled.",
};

const HEURISTIC_KITS = new Set(["kit1", "kit11", "kit13", "kit14", "kit15", "kit16"]);

export function generateStaticParams() {
  return KITS.map((kit) => ({ id: kit.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const kit = getKit(id);
  return { title: kit ? `${kit.num}. ${kit.name} — Developer Lab` : "Kit not found" };
}

export default async function KitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const kit = getKit(id);
  if (!kit) notFound();

  const index = KITS.findIndex((k) => k.id === kit.id);
  const prev = KITS[index - 1];
  const next = KITS[index + 1];
  const group = KIT_GROUPS.find((g) => g.id === kit.groupId);

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={
            <>
              <Tag tone={kit.access.tone} size="sm">
                {kit.access.label}
              </Tag>
              {group && (
                <Tag tone="neutral" size="sm">
                  {group.title}
                </Tag>
              )}
            </>
          }
          title={`${kit.num}. ${kit.name}`}
          description={kit.decision}
          actions={
            <>
              {prev && (
                <Button variant="secondary" size="sm" href={`/kits/${prev.id}`}>
                  ← {prev.num}
                </Button>
              )}
              {next && (
                <Button variant="secondary" size="sm" href={`/kits/${next.id}`}>
                  {next.num} →
                </Button>
              )}
            </>
          }
        />

        <div className="border-border bg-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-3">
          <div className="bg-card flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <span className="caption-style text-subtle">Command</span>
            <code className="font-mono text-[13px] text-chip">{kit.command}</code>
          </div>
          <div className="bg-card flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <span className="caption-style text-subtle">Access</span>
            <span className="text-[13px] text-soft">
              {ACCESS_NOTES[kit.access.label]}
            </span>
          </div>
          <div className="bg-card flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <span className="caption-style text-subtle">Narrative</span>
            <span className="text-[13px] text-soft">
              Goal → plan → new info → decision → outcome
            </span>
          </div>
        </div>

        <RunPanel kitId={kit.id} supportsHeuristic={HEURISTIC_KITS.has(kit.id)} />
      </div>
    </Shell>
  );
}
