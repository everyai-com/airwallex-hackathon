import Tag from "@/components/ui/tag";
import type { RunEvent } from "@/lib/run-types";

function Chapter({ title }: { title: string }) {
  return (
    <h3 className="border-border border-t pt-4 first:border-0 first:pt-0">
      {title}
    </h3>
  );
}

export default function RunEvents({ events }: { events: RunEvent[] }) {
  return (
    <div className="flex flex-col gap-2">
      {events.map((event, index) => {
        switch (event.type) {
          case "chapter":
            return <Chapter key={index} title={event.title} />;
          case "step":
            return (
              <p key={index} className="lead-style pt-2 font-medium">
                {event.title}
              </p>
            );
          case "info":
            return (
              <p key={index} className="text-soft">
                {event.message}
              </p>
            );
          case "detail":
            return (
              <div key={index} className="flex gap-3 text-[13px] leading-snug">
                <span className="text-subtle w-32 shrink-0">{event.label}</span>
                <span className="text-chip min-w-0">{event.value}</span>
              </div>
            );
          case "decision":
            return (
              <div
                key={index}
                className="border-line-strong bg-secondary flex gap-2 rounded-lg border px-3 py-2 text-[13px] leading-snug"
              >
                <Tag tone="amber" size="sm" className="mt-px shrink-0">
                  Decision
                </Tag>
                <span className="min-w-0">
                  <span className="font-medium">{event.label}</span>
                  <span className="text-soft"> — {event.reason}</span>
                </span>
              </div>
            );
        }
      })}
    </div>
  );
}
