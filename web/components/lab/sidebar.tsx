"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/button";
import CountBadge from "@/components/ui/count-badge";
import { cn } from "@/lib/utils";
import { KIT_GROUPS, KITS, kitsInGroup } from "@/lib/kits";
import {
  CloseIcon,
  KitIcon,
  LogoMark,
  MenuIcon,
  OverviewIcon,
} from "@/components/lab/icons";

function SidebarSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 p-3", className)}>
      {title && (
        <span className="eyebrow-style block font-medium text-faint">{title}</span>
      )}
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
  badge,
  onNavigate,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: string;
  onNavigate?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <li className={cn(active && "mb-0.75")}>
      <Button
        variant="nav"
        size="md"
        href={href}
        data-active={active}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className="group h-[30px] gap-1.5 py-0 data-[active=true]:h-8"
      >
        <span className="text-subtle ease-power3-out group-hover:text-icon group-data-[active=true]:text-icon size-3.5 shrink-0 transition-colors duration-150 [&>svg]:size-3.5">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {badge !== undefined && <CountBadge>{badge}</CountBadge>}
      </Button>
    </li>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-sidebar-border bg-sidebar-accent flex shrink-0 items-center gap-2 border-b p-3">
        <LogoMark aria-hidden className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="lead-style block truncate font-medium tracking-[-0.01em]">
            Developer Lab
          </span>
          <span className="caption-style text-subtle block truncate">
            Agentic Banking · 16 kits
          </span>
        </div>
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto">
        <SidebarSection>
          <NavItem
            href="/"
            label="Overview"
            active={pathname === "/"}
            onNavigate={onNavigate}
            icon={<OverviewIcon />}
          />
        </SidebarSection>

        {KIT_GROUPS.map((group) => (
          <SidebarSection
            key={group.id}
            title={group.title}
            className="border-sidebar-border border-t"
          >
            {kitsInGroup(group.id).map((kit) => (
              <NavItem
                key={kit.id}
                href={`/kits/${kit.id}`}
                label={kit.name}
                active={pathname === `/kits/${kit.id}`}
                badge={String(kit.num).padStart(2, "0")}
                onNavigate={onNavigate}
                icon={<KitIcon id={kit.id} />}
              />
            ))}
          </SidebarSection>
        ))}
      </nav>

      <div className="border-sidebar-border flex shrink-0 items-center justify-between border-t p-3">
        <span className="caption-style text-faint">Model reads · code decides</span>
        <CountBadge>{KITS.length}</CountBadge>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="border-sidebar-border bg-sidebar flex shrink-0 items-center gap-2 border-b p-3 lg:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
        >
          <MenuIcon className="size-4" />
        </Button>
        <LogoMark aria-hidden className="size-6 shrink-0" />
        <span className="lead-style font-medium">Developer Lab</span>
      </div>

      <aside className="relative hidden w-(--sidebar-width) shrink-0 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="border-sidebar-border bg-sidebar absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r">
            <div className="flex justify-end p-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                <CloseIcon className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarContent onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
