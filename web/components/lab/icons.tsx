import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </Base>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2" y="4" width="12" height="9" rx="1.5" />
      <path d="M2 7h12" />
      <circle cx="11.5" cy="10.5" r="0.5" fill="currentColor" />
    </Base>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2 6.5h12M5 10h4" />
    </Base>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.2" r="0.5" fill="currentColor" />
    </Base>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 2 12.5 3.8v3.7c0 3-2 4.9-4.5 6.5-2.5-1.6-4.5-3.5-4.5-6.5V3.8L8 2Z" />
      <path d="M6.2 7.5 7.4 8.7 9.8 6" />
    </Base>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5 8 2.5Z" />
      <path d="M2.5 8.5 8 11.5l5.5-3M2.5 11.5 8 14.5l5.5-3" />
    </Base>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <circle cx="11.5" cy="6" r="2" />
      <path d="M11.5 9.7c1.9.3 3 1.6 3 3.3" />
    </Base>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 13.5h12" />
      <path d="M2.5 10.5 6 7l2.5 2.5L13.5 4" />
      <path d="M10.5 4h3v3" />
    </Base>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.5 6 3.5 2.5h9L13.5 6" />
      <path d="M2.5 6v7.5h11V6M2.5 6h11" />
      <path d="M6.5 13.5v-3h3v3" />
    </Base>
  );
}

export function BagIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 5.5h9l-0.7 8h-7.6l-0.7-8Z" />
      <path d="M6 7V5.2a2 2 0 0 1 4 0V7" />
    </Base>
  );
}

export function CheckoutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M5.8 8.2l1.6 1.6 3-3.2" />
    </Base>
  );
}

export function ReconIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8.2 7.2 10 10.6 6.2" />
    </Base>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 2.5h8.5a1 1 0 0 1 1 1v10H4.5a1 1 0 0 1-1-1v-10Z" />
      <path d="M3.5 10.5H13M6 5.5h4" />
    </Base>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.2 1.3" />
    </Base>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 3.5v9l7-4.5-7-4.5Z" />
    </Base>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.5 5h11M2.5 8h11M2.5 11h11" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Base>
  );
}

export function LogoMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden {...props}>
      <rect width="32" height="32" rx="8" fill="#4124fb" />
      <path
        d="M9 21.5 13.5 10l3 6 2.5-3.5L23 21.5"
        fill="none"
        stroke="#f9fbff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const KIT_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  kit1: WalletIcon,
  kit2: CardIcon,
  kit3: AlertIcon,
  kit4: ShieldIcon,
  kit5: LayersIcon,
  kit6: UsersIcon,
  kit7: TrendIcon,
  kit8: StoreIcon,
  kit9: BagIcon,
  kit10: CheckoutIcon,
  kit11: ReconIcon,
  kit12: BookIcon,
  kit13: ClockIcon,
  kit14: BookIcon,
  kit15: UsersIcon,
  kit16: TrendIcon,
};

export function KitIcon({ id, ...props }: IconProps & { id: string }) {
  const Icon = KIT_ICONS[id] ?? OverviewIcon;
  return <Icon {...props} />;
}
