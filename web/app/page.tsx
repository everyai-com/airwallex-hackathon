import Button from "@/components/ui/button";
import Tag from "@/components/ui/tag";
import KitTables from "@/components/lab/kit-tables";
import PageHeader from "@/components/lab/page-header";
import Shell from "@/components/lab/shell";
import StatusStrip from "@/components/lab/status-strip";
import { PlayIcon } from "@/components/lab/icons";

export default function Home() {
  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={
            <>
              <Tag tone="neutral" size="sm">
                18 kits
              </Tag>
              <Tag tone="neutral" size="sm">
                Mock + Live
              </Tag>
            </>
          }
          title="Overview"
          description="The model reads, the code decides, the API moves the money. Every kit follows one arc — goal, initial plan, new information, revised decision, outcome."
          actions={
            <Button variant="primary" size="sm" href="/kits/kit1">
              <PlayIcon className="size-3.5" />
              Run the Treasury demo
            </Button>
          }
        />
        <StatusStrip />
        <KitTables />
      </div>
    </Shell>
  );
}
