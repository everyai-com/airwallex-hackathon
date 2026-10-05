/**
 * Kit 15 policy — supplier bank-detail validation, pure and testable.
 *
 * The rule: the analyst may flag the shape of an onboarding letter, but field
 * extraction, checksums, the corridor decision and the approval rule are code.
 * A letter the analyst and the parser read differently is held for a person.
 */

import type { SupplierDocReading } from '../../core/analyst.js';

export const ONBOARDING_POLICY = {
  /** Verification transfer per approved beneficiary, in the corridor currency. */
  verificationAmount: 25,
};

export type Corridor = 'us-local' | 'gb-local' | 'de-swift';

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  postcode: string;
  countryCode: string;
}

export interface ParsedSupplier {
  reference: string;
  supplier: string;
  accountName?: string;
  accountNumber?: string;
  abaRouting?: string;
  sortCode?: string;
  iban?: string;
  swiftCode?: string;
  bankName?: string;
  address?: ParsedAddress;
}

export type OnboardingAction = 'APPROVE' | 'HOLD';

export interface OnboardingDecision {
  reference: string;
  action: OnboardingAction;
  corridor?: Corridor;
  requiresApproval: boolean;
  reason: string;
}

const field = (text: string, label: string): string | undefined => {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  const value = match?.[1]?.trim();
  return value ? value : undefined;
};

/** ABA checksum: weights 3-7-1 repeating, sum must be a multiple of 10. */
export function abaValid(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(routing[index]) * weights[index % 3]!;
  }
  return sum % 10 === 0;
}

/** IBAN checksum: rearranged numeric value mod 97 must equal 1. */
export function ibanValid(iban: string): boolean {
  const compact = iban.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function swiftValid(code: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(code.trim().toUpperCase());
}

export function sortCodeValid(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/[\s-]/g, ''));
}

/** Deterministic parse of the semi-structured onboarding letter. No model involved. */
export function parseSupplierDoc(reference: string, supplier: string, text: string): ParsedSupplier {
  const addressLine = field(text, 'ADDR');
  const parts = (addressLine ?? '').split('|').map((part) => part.trim());
  return {
    reference,
    supplier,
    accountName: field(text, 'ACCOUNT NAME'),
    accountNumber: field(text, 'ACCOUNT NUMBER'),
    abaRouting: field(text, 'ABA ROUTING'),
    sortCode: field(text, 'SORT CODE'),
    iban: field(text, 'IBAN'),
    swiftCode: field(text, 'SWIFT'),
    bankName: field(text, 'BANK'),
    ...(parts.length === 5
      ? {
          address: {
            street: parts[0]!,
            city: parts[1]!,
            state: parts[2]!,
            postcode: parts[3]!,
            countryCode: parts[4]!,
          },
        }
      : {}),
  };
}

/**
 * Corridor inference from the routing fields present. Conflicting routings
 * (an ABA and an IBAN in one letter) resolve to no corridor — a hold.
 */
export function inferCorridor(parsed: ParsedSupplier): Corridor | undefined {
  const hasAba = parsed.abaRouting !== undefined;
  const hasSort = parsed.sortCode !== undefined;
  const hasIban = parsed.iban !== undefined;
  const count = [hasAba, hasSort, hasIban].filter(Boolean).length;
  if (count !== 1) return undefined;
  if (hasAba) return 'us-local';
  if (hasSort) return 'gb-local';
  return 'de-swift';
}

export function validateCorridorFields(parsed: ParsedSupplier, corridor: Corridor): string[] {
  const problems: string[] = [];
  if (!parsed.accountName) problems.push('account name is missing');
  if (!parsed.address) problems.push('address is missing or malformed');
  if (corridor === 'us-local') {
    if (!parsed.accountNumber || !/^\d{4,17}$/.test(parsed.accountNumber)) {
      problems.push('US account number must be 4-17 digits');
    }
    if (!parsed.abaRouting || !abaValid(parsed.abaRouting)) {
      problems.push('ABA routing is missing or fails the checksum');
    }
  }
  if (corridor === 'gb-local') {
    if (parsed.accountNumber !== undefined && !/^\d{8}$/.test(parsed.accountNumber)) {
      problems.push('GB account number must be 8 digits');
    }
    if (!parsed.accountNumber) problems.push('GB account number is missing');
    if (!parsed.sortCode || !sortCodeValid(parsed.sortCode)) {
      problems.push('sort code must be 6 digits');
    }
    if (!parsed.bankName) problems.push('GB bank name is required');
  }
  if (corridor === 'de-swift') {
    if (!parsed.iban || !ibanValid(parsed.iban)) {
      problems.push('IBAN is missing or fails the checksum');
    }
    if (!parsed.swiftCode || !swiftValid(parsed.swiftCode)) {
      problems.push('SWIFT code is missing or malformed');
    }
    if (!parsed.bankName) problems.push('bank name is required');
  }
  return problems;
}

export function decideOnboarding(
  parsed: ParsedSupplier,
  reading: SupplierDocReading,
): OnboardingDecision {
  const corridor = inferCorridor(parsed);
  const hold = (reason: string): OnboardingDecision => ({
    reference: parsed.reference,
    action: 'HOLD',
    ...(corridor ? { corridor } : {}),
    requiresApproval: true,
    reason,
  });

  if (!reading.mentionsBankDetails) {
    return hold('The letter carries no bank details the analyst can see — nothing to validate.');
  }
  if (reading.mentionsMultipleCountries) {
    return hold('The letter signals more than one country or corridor — a person picks the right one.');
  }
  if (reading.mentionsMissingDetails) {
    return hold('The writer flags details as missing or unconfirmed — held until the correction lands.');
  }
  if (!corridor) {
    return hold('The routing fields point at zero or several corridors — a person resolves the conflict.');
  }
  const problems = validateCorridorFields(parsed, corridor);
  if (problems.length > 0) {
    return hold(`Corridor ${corridor} fails validation: ${problems.join('; ')}.`);
  }
  return {
    reference: parsed.reference,
    action: 'APPROVE',
    corridor,
    requiresApproval: false,
    reason: `Corridor ${corridor} validates — checksums pass, every required field is present.`,
  };
}
