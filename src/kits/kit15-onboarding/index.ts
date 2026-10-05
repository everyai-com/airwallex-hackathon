import {
  createBeneficiary,
  euSwiftBeneficiary,
  gbLocalBeneficiary,
  getBeneficiarySchema,
  usLocalBeneficiary,
  type Address,
} from '../../api/beneficiaries.js';
import { balanceOf, getBalances } from '../../api/balances.js';
import { advanceTransferToPaid, createTransfer, type TransferRecord } from '../../api/transfers.js';
import { createAnalyst } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import { CORRECTED_DOC, SUPPLIER_DOCS, type SupplierDoc } from './documents.js';
import {
  ONBOARDING_POLICY,
  decideOnboarding,
  parseSupplierDoc,
  type Corridor,
  type OnboardingDecision,
  type ParsedSupplier,
} from './policy.js';

export interface Kit15Options {
  autoApprove?: boolean;
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface OnboardedSupplier {
  reference: string;
  supplier: string;
  corridor: Corridor;
  beneficiaryId: string;
  verificationId: string;
  verificationStatus: string;
  currency: string;
  amount: number;
  /** Amount actually debited this run — 0 when the transfer resumed PAID. */
  spentThisRun: number;
}

export interface Kit15Result {
  decisions: OnboardingDecision[];
  onboarded: OnboardedSupplier[];
  escalationNote?: string;
  wallet: Record<string, number>;
}

const CORRIDOR_META: Record<Corridor, { currency: string; method: 'LOCAL' | 'SWIFT' }> = {
  'us-local': { currency: 'USD', method: 'LOCAL' },
  'gb-local': { currency: 'GBP', method: 'LOCAL' },
  'de-swift': { currency: 'EUR', method: 'SWIFT' },
};

/**
 * Supplier Onboarding Agent — the payouts loop for new payees: read the
 * onboarding letter, validate every bank detail in code (checksums included),
 * create the beneficiary, and prove the corridor with a verification transfer.
 */
export async function runKit15(
  client: AirwallexClient,
  logger: Logger,
  options: Kit15Options = {},
): Promise<Kit15Result> {
  const ids = client.requestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ USD: 30_000, EUR: 10_000, GBP: 5_000 });
  const openingBalances = await getBalances(client);
  const startingCash = {
    USD: balanceOf(openingBalances, 'USD'),
    EUR: balanceOf(openingBalances, 'EUR'),
    GBP: balanceOf(openingBalances, 'GBP'),
  };

  logger.chapter('Supplier Onboarding Agent — observe → decide → act → reconcile');
  logger.info(
    'Goal: onboard three suppliers from their own letters — validate in code, create the beneficiary, and verify each corridor with a funded transfer.',
  );
  logger.detail(
    'Analyst',
    `${analyst.kind} — flags bank details, multi-country signals and missing fields; extraction and checksums are code`,
  );

  const parsed = new Map<string, ParsedSupplier>();
  logger.chapter('Observe — the analyst reads, the parser measures');
  for (const doc of SUPPLIER_DOCS) {
    const reading = await analyst.readSupplierDoc({
      supplier: doc.supplier,
      reference: doc.reference,
      text: doc.text,
    });
    parsed.set(doc.id, parseSupplierDoc(doc.reference, doc.supplier, doc.text));
    logger.detail(`${doc.reference} · ${doc.supplier}`, reading.rationale);
    for (const quote of reading.citedEvidence) logger.detail('Cited', `"${quote}"`);
  }

  const onboard = async (doc: SupplierDoc, terms: ParsedSupplier, corridor: Corridor): Promise<OnboardedSupplier> => {
    const meta = CORRIDOR_META[corridor];
    const countryCode = corridor === 'us-local' ? 'US' : corridor === 'gb-local' ? 'GB' : 'DE';
    await getBeneficiarySchema(client, {
      countryCode,
      currency: meta.currency,
      transferMethod: meta.method,
    });
    const address: Address = {
      streetAddress: terms.address!.street,
      city: terms.address!.city,
      state: terms.address!.state,
      postcode: terms.address!.postcode,
      countryCode: terms.address!.countryCode,
    };
    const payload =
      corridor === 'us-local'
        ? usLocalBeneficiary({
            accountName: terms.accountName!,
            accountNumber: terms.accountNumber!,
            routingNumber: terms.abaRouting!,
            bankName: terms.bankName,
            address,
          })
        : corridor === 'gb-local'
          ? gbLocalBeneficiary({
              accountName: terms.accountName!,
              accountNumber: terms.accountNumber!,
              sortCode: terms.sortCode!.replace(/[\s-]/g, ''),
              bankName: terms.bankName!,
              address,
            })
          : euSwiftBeneficiary({
              accountName: terms.accountName!,
              iban: terms.iban!.replace(/[\s-]/g, ''),
              swiftCode: terms.swiftCode!,
              bankName: terms.bankName!,
              address,
            });
    const beneficiary = await createBeneficiary(client, payload);
    logger.detail('Beneficiary', `${beneficiary.id} (${corridor}, checksums passed)`);

    const transfer = await createTransfer(client, {
      requestId: ids.forOperation(`verify-${doc.id}`),
      transferCurrency: meta.currency,
      transferAmount: ONBOARDING_POLICY.verificationAmount,
      transferMethod: meta.method,
      reason: TRANSFER_REASONS.goodsPurchased,
      reference: `${doc.reference} corridor verification`,
      beneficiaryId: beneficiary.id,
    });
    const resumed = transfer.status === 'PAID';
    const paid = await advanceTransferToPaid(client, transfer);
    logger.detail(
      'Verification',
      `${paid.id} ${formatAmount(paid.transferAmount, paid.transferCurrency)} → ${paid.status}${resumed ? ' (resumed, no new spend)' : ''}`,
    );
    return {
      reference: doc.reference,
      supplier: doc.supplier,
      corridor,
      beneficiaryId: beneficiary.id,
      verificationId: paid.id,
      verificationStatus: paid.status,
      currency: meta.currency,
      amount: paid.transferAmount,
      spentThisRun: resumed ? 0 : paid.transferAmount,
    };
  };

  const decisions: OnboardingDecision[] = [];
  const onboarded: OnboardedSupplier[] = [];
  let escalationNote: string | undefined;

  logger.chapter('Decide and act — approve the valid, hold the doubtful');
  for (const doc of SUPPLIER_DOCS) {
    const terms = parsed.get(doc.id)!;
    const reading = await analyst.readSupplierDoc({
      supplier: doc.supplier,
      reference: doc.reference,
      text: doc.text,
    });
    const decision = decideOnboarding(terms, reading);
    decisions.push(decision);
    await logger.step(`${doc.reference} — ${doc.supplier}`, async () => {
      logger.decision(decision.action, decision.reason);
      if (decision.action === 'APPROVE' && decision.corridor) {
        onboarded.push(await onboard(doc, terms, decision.corridor));
      } else {
        const approval = await gate.request({
          operationId: `escalate-${doc.id}`,
          summary: `Hold onboarding ${doc.reference} for review`,
          amount: 0,
          currency: 'USD',
          counterparty: doc.supplier,
          evidence: [decision.reason],
        });
        escalationNote = await analyst.explainException({
          counterparty: doc.supplier,
          amount: 0,
          currency: 'USD',
          reason: decision.reason,
        });
        logger.decision(
          approval.approved ? 'ESCALATED' : 'HELD',
          `${escalationNote} Approved by ${approval.approver}.`,
        );
      }
    });
  }

  logger.chapter('New information — the corrected letter lands');
  const correctionReading = await analyst.readSupplierDoc(CORRECTED_DOC);
  logger.detail('Analyst', correctionReading.rationale);
  for (const quote of correctionReading.citedEvidence) logger.detail('Cited', `"${quote}"`);
  const gbDoc = SUPPLIER_DOCS.find((entry) => entry.id === 'sup-gb')!;
  const corrected = parseSupplierDoc(gbDoc.reference, gbDoc.supplier, CORRECTED_DOC.text);
  const revised = decideOnboarding(corrected, correctionReading);
  decisions.push(revised);
  logger.decision('REVISED', revised.reason);
  if (revised.action === 'APPROVE' && revised.corridor) {
    await logger.step(`${gbDoc.reference} — ${gbDoc.supplier} (corrected)`, async () => {
      onboarded.push(await onboard(gbDoc, corrected, revised.corridor!));
    });
  }

  logger.chapter('Outcome');
  if (onboarded.length !== 3) {
    throw new Error(`Expected 3 onboarded suppliers, got ${onboarded.length}.`);
  }
  const unpaid = onboarded.filter((entry) => entry.verificationStatus !== 'PAID');
  if (unpaid.length > 0) {
    throw new Error(
      `Verification transfers not PAID: ${unpaid.map((entry) => entry.reference).join(', ')}.`,
    );
  }
  const spent: Record<string, number> = {};
  for (const entry of onboarded) {
    spent[entry.currency] = round2((spent[entry.currency] ?? 0) + entry.spentThisRun);
  }
  const ending = await getBalances(client);
  for (const [currency, amount] of Object.entries(spent)) {
    const moved = round2(
      (startingCash[currency as keyof typeof startingCash] ?? 0) - balanceOf(ending, currency),
    );
    // Fees ride on top of the verification amount; the wallet must move by at
    // least the verified sum per currency.
    if (moved + 0.005 < amount) {
      throw new Error(
        `Cash identity broken: ${currency} wallet moved ${moved} but verifications total ${amount}.`,
      );
    }
  }
  for (const entry of onboarded) {
    logger.detail(
      entry.reference,
      `${entry.corridor} — beneficiary ${entry.beneficiaryId}, verification ${formatAmount(entry.amount, entry.currency)} ${entry.verificationStatus}`,
    );
  }
  logger.detail(
    'Identity',
    `3 beneficiaries, 3 PAID verifications (${Object.entries(spent)
      .map(([currency, amount]) => `${currency} ${amount}`)
      .join(' + ')}), every wallet moved by at least its verified sum`,
  );
  if (escalationNote) logger.detail('Escalation', escalationNote);

  return {
    decisions,
    onboarded,
    ...(escalationNote ? { escalationNote } : {}),
    wallet: {
      USD: balanceOf(ending, 'USD'),
      EUR: balanceOf(ending, 'EUR'),
      GBP: balanceOf(ending, 'GBP'),
    },
  };
}
