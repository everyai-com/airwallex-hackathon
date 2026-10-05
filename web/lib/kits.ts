export type TagTone =
  | "blue"
  | "purple"
  | "green"
  | "moss"
  | "red"
  | "orange"
  | "amber"
  | "teal"
  | "yellow"
  | "neutral";

export interface KitGroup {
  id: string;
  title: string;
  blurb: string;
}

export interface Kit {
  id: string;
  num: number;
  name: string;
  decision: string;
  groupId: string;
  access: { label: string; tone: TagTone };
  command: string;
}

export const KIT_GROUPS: KitGroup[] = [
  {
    id: "cash",
    title: "Cash & Control",
    blurb: "Treasury, purchases, incidents, disputes — one sandbox account.",
  },
  {
    id: "platform",
    title: "Platform",
    blurb: "Connected accounts and platform payments, four kits deep.",
  },
  {
    id: "commerce",
    title: "Agentic Commerce",
    blurb: "Shopper-side approvals and merchant-side checkout.",
  },
  {
    id: "finance",
    title: "Finance Ops",
    blurb: "Reconciliation, close, and collections on the same wallet.",
  },
];

export const KITS: Kit[] = [
  {
    id: "kit1",
    num: 1,
    name: "Adaptive Treasury Controller",
    decision: "Fund, convert, defer, or escalate each obligation when cash is short.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit1",
  },
  {
    id: "kit2",
    num: 2,
    name: "Intent-Bound Purchase Agent",
    decision: "Annual vs monthly SaaS terms, then card controls that enforce the choice.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit2",
  },
  {
    id: "kit3",
    num: 3,
    name: "Payment Ops Incident Commander",
    decision: "Wait, replace, or escalate a failed transfer — never pay twice.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit3",
  },
  {
    id: "kit4",
    num: 4,
    name: "Dispute Response Agent",
    decision: "Accept, challenge, or escalate chargebacks from evidence and fees.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit4",
  },
  {
    id: "kit5",
    num: 5,
    name: "Platform Spend Controller",
    decision: "Issue cards to connected accounts; ration bridge funding when late.",
    groupId: "platform",
    access: { label: "Platform", tone: "purple" },
    command: "npm run kit5",
  },
  {
    id: "kit6",
    num: 6,
    name: "Multi-Employer Payroll Executor",
    decision: "Run payroll per employer — never one employer's funds for another.",
    groupId: "platform",
    access: { label: "Platform", tone: "purple" },
    command: "npm run kit6",
  },
  {
    id: "kit7",
    num: 7,
    name: "Portfolio Lending Agent",
    decision: "Collect revenue-based repayments; size advances above the reserve floor.",
    groupId: "platform",
    access: { label: "Platform", tone: "purple" },
    command: "npm run kit7",
  },
  {
    id: "kit8",
    num: 8,
    name: "Marketplace Settlement Agent",
    decision: "Set reserves, pay net proceeds, recompute one reserve when risk moves.",
    groupId: "platform",
    access: { label: "Platform", tone: "purple" },
    command: "npm run kit8",
  },
  {
    id: "kit9",
    num: 9,
    name: "Approval-Bound Shopping Agent",
    decision: "Re-approve on any change; report to Airi before any retry.",
    groupId: "commerce",
    access: { label: "Airi", tone: "blue" },
    command: "npm run kit9",
  },
  {
    id: "kit10",
    num: 10,
    name: "Merchant-Enabled Agentic Checkout",
    decision: "Snapshot prices into sessions; refuse stale charges; dedupe retries.",
    groupId: "commerce",
    access: { label: "Merchant", tone: "teal" },
    command: "npm run kit10",
  },
  {
    id: "kit11",
    num: 11,
    name: "Invoice-Matching Reconciliation Agent",
    decision: "Match every receipt; prove the AR and cash identities.",
    groupId: "finance",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit11",
  },
  {
    id: "kit12",
    num: 12,
    name: "Zero-Day Close Agent",
    decision: "Cutoff, revaluation, accruals — a balanced journal tied to the wallet.",
    groupId: "finance",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit12",
  },
  {
    id: "kit13",
    num: 13,
    name: "AR Collections Agent",
    decision: "Proportionate pressure per invoice — remind, plan, escalate, write off.",
    groupId: "finance",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit13",
  },
  {
    id: "kit14",
    num: 14,
    name: "Contract-to-Cash Billing Agent",
    decision: "Issue, hold, or partially bill each contract — then collect and reconcile.",
    groupId: "finance",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit14",
  },
  {
    id: "kit15",
    num: 15,
    name: "Supplier Onboarding Agent",
    decision: "Checksum bank details in code; verify each corridor with a funded transfer.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit15",
  },
  {
    id: "kit16",
    num: 16,
    name: "FX Exposure Hedger",
    decision: "Hedge surpluses to the market view; buy shortfalls whatever it says.",
    groupId: "cash",
    access: { label: "Sandbox", tone: "green" },
    command: "npm run kit16",
  },
];

export function getKit(id: string): Kit | undefined {
  return KITS.find((kit) => kit.id === id);
}

export function kitsInGroup(groupId: string): Kit[] {
  return KITS.filter((kit) => kit.groupId === groupId);
}
