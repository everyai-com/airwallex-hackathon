import Link from "next/link";
import Tag from "@/components/ui/tag";
import { KitIcon } from "@/components/lab/icons";
import { KIT_GROUPS, kitsInGroup } from "@/lib/kits";

export default function KitTables() {
  return (
    <div className="flex flex-col gap-8">
      {KIT_GROUPS.map((group) => (
        <section key={group.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-3">
            <h2>{group.title}</h2>
            <p className="caption-style text-subtle">{group.blurb}</p>
          </div>
          <div className="border-border bg-card overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-[14px] leading-none">
              <thead>
                <tr className="border-border border-b">
                  <th className="caption-style h-[38px] px-3 text-left align-middle font-normal whitespace-nowrap text-subtle">
                    Kit
                  </th>
                  <th className="caption-style h-[38px] px-3 text-left align-middle font-normal whitespace-nowrap text-subtle">
                    The decision
                  </th>
                  <th className="caption-style hidden h-[38px] px-3 text-left align-middle font-normal whitespace-nowrap text-subtle md:table-cell">
                    Access
                  </th>
                  <th className="caption-style hidden h-[38px] px-3 text-left align-middle font-normal whitespace-nowrap text-subtle lg:table-cell">
                    Command
                  </th>
                </tr>
              </thead>
              <tbody>
                {kitsInGroup(group.id).map((kit) => (
                  <tr
                    key={kit.id}
                    className="border-border ease-power3-out border-b transition-colors duration-150 last:border-0 hover:bg-white/4"
                  >
                    <td className="px-3 py-3 align-middle whitespace-nowrap">
                      <Link
                        href={`/kits/${kit.id}`}
                        className="flex items-center gap-2 outline-none focus-visible:underline"
                      >
                        <span className="text-subtle size-4 shrink-0 [&>svg]:size-4">
                          <KitIcon id={kit.id} />
                        </span>
                        <span className="font-medium">
                          {kit.num}. {kit.name}
                        </span>
                      </Link>
                    </td>
                    <td className="text-soft max-w-md px-3 py-3 align-middle text-[13px] leading-snug text-balance">
                      {kit.decision}
                    </td>
                    <td className="hidden px-3 py-3 align-middle md:table-cell">
                      <Tag tone={kit.access.tone} size="sm">
                        {kit.access.label}
                      </Tag>
                    </td>
                    <td className="hidden px-3 py-3 align-middle whitespace-nowrap lg:table-cell">
                      <code className="text-subtle font-mono text-[12px]">
                        {kit.command}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
