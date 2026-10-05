import {
  createBeneficiary,
  euSwiftBeneficiary,
  gbLocalBeneficiary,
  usLocalBeneficiary,
} from '../../api/beneficiaries.js';
import { balanceOf, getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { advanceTransferToPaid, createTransfer, type TransferRecord } from '../../api/transfers.js';
import { createAnalyst } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import {
  DISPUTED_LEG_ID,
  DISPUTE_MEMO,
  INTERCOMPANY_LEGS,
  NETTING_STARTING_BALANCES,
  type EntityId,
} from './scenario.js';
import {
  assertNetsZero,
  netPositions,
  planSettlements,
  settlementTotals,
  type Settlement,
} from './policy.js';

export interface Kit18Options {
  autoApprove?: boolean;
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface Kit18Result {
  grossCount: number;
  netCount: number;
  settlements: Settlement[];
  transfers: TransferRecord[];
  escalationNote?: string;
}

const ENTITY_BENEFICIARY: Record<EntityId, { currency: 'USD' | 'EUR' | 'GBP'; method: 'LOCAL' | 'SWIFT' }> = {
  US: { currency: 'USD', method: 'LOCAL' },
  SG: { currency: 'USD', method: 'LOCAL' },
  DE: { currency: 'EUR', method: 'SWIFT' },
  UK: { currency: 'GBP', method: 'LOCAL' },
};

/**
 * Intercompany Settlement Agent — the treasury loop for internal obligations:
 * net eleven gross legs into the minimal settlement set, exclude the disputed
 * leg on the analyst's flag, and pay every net to PAID.
 */
export async function runKit18(
  client: AirwallexClient,
  logger: Logger,
  options: Kit18Options = {},
): Promise<Kit18Result> {
  const ids = client.requestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ ...NETTING_STARTING_BALANCES });

  logger.chapter('Intercompany Settlement Agent — observe → decide → act → reconcile');
  logger.info(
    'Goal: settle eleven intercompany legs with the fewest funded transfers — net in code, exclude the disputed leg, pay every net to PAID.',
  );
  logger.detail('Analyst', `${analyst.kind} — flags the disputed leg; nets, zero-sum and the plan are code`);

  logger.chapter('Observe — eleven gross legs');
  for (const leg of INTERCOMPANY_LEGS) {
    logger.detail(
      leg.id,
      `${leg.from} → ${leg.to} ${formatAmount(leg.amount, leg.currency)} — ${leg.memo}`,
    );
  }
  const grossNets = netPositions(INTERCOMPANY_LEGS);
  assertNetsZero(grossNets);
  const grossPlan = planSettlements(grossNets);
  logger.detail('Gross plan', `${INTERCOMPANY_LEGS.length} legs net to ${grossPlan.length} transfers`);

  logger.chapter('New information — DE disputes IC-2214');
  const reading = await analyst.readContract({
    customer: DISPUTE_MEMO.counterparty,
    reference: DISPUTE_MEMO.reference,
    text: DISPUTE_MEMO.text,
  });
  logger.detail('Analyst', reading.rationale);
  for (const quote of reading.citedEvidence) logger.detail('Cited', `"${quote}"`);
  const disputed = INTERCOMPANY_LEGS.find((leg) => leg.id === DISPUTED_LEG_ID)!;
  let escalationNote: string | undefined;
  if (reading.mentionsDispute) {
    const approval = await gate.request({
      operationId: `escalate-${disputed.id}`,
      summary: `Exclude disputed ${disputed.id} (${disputed.memo}) from the net`,
      amount: disputed.amount,
      currency: disputed.currency,
      counterparty: DISPUTE_MEMO.counterparty,
      evidence: reading.citedEvidence,
    });
    escalationNote = await analyst.explainException({
      counterparty: DISPUTE_MEMO.counterparty,
      amount: disputed.amount,
      currency: disputed.currency,
      reason: `leg ${disputed.id} is disputed and leaves the net`,
    });
    logger.decision(
      approval.approved ? 'ESCALATED' : 'HELD',
      `${escalationNote} Approved by ${approval.approver}.`,
    );
  }

  const nettable = INTERCOMPANY_LEGS.filter((leg) => leg.id !== DISPUTED_LEG_ID);
  const nets = netPositions(nettable);
  assertNetsZero(nets);
  const settlements = planSettlements(nets);
  logger.chapter('Decide — the minimal settlement set');
  for (const entry of settlements) {
    logger.decision(
      'SETTLE',
      `${entry.from} → ${entry.to} ${formatAmount(entry.amount, entry.currency)}`,
    );
  }
  logger.detail(
    'Savings',
    `${INTERCOMPANY_LEGS.length} gross legs → ${settlements.length} net transfers, 1 disputed leg excluded`,
  );

  if (!client.isMock) {
    await logger.step('Sandbox setup — fund the net debits', async () => {
      const totals = settlementTotals(settlements);
      const opening = await getBalances(client);
      for (const [currency, amount] of Object.entries(totals)) {
        const current = balanceOf(opening, currency);
        if (current + 0.01 < amount) {
          const account = await ensureGlobalAccount(client, currency);
          await simulateDeposit(client, {
            globalAccountId: account.id,
            amount: round2(amount - current),
            payerName: 'Netting scenario funding',
          });
          logger.detail(`${currency} funded`, `${round2(amount - current)} to cover ${amount}`);
        }
      }
    });
  }

  logger.chapter('Act — onboard the entities, pay every net');
  const entityBeneficiary = async (entity: EntityId): Promise<string> => {
    const names: Record<EntityId, string> = {
      US: 'US Parent Corp',
      DE: 'DE Sub GmbH',
      UK: 'UK Sub Ltd',
      SG: 'SG Sub Pte Ltd',
    };
    const payload =
      entity === 'DE'
        ? euSwiftBeneficiary({
            accountName: names.DE,
            iban: 'DE89370400440532013000',
            swiftCode: 'COBADEFFXXX',
            bankName: 'Commerzbank',
            address: {
              streetAddress: 'Kaiserstrasse 16',
              city: 'Frankfurt',
              state: 'HE',
              postcode: '60311',
              countryCode: 'DE',
            },
          })
        : entity === 'UK'
          ? gbLocalBeneficiary({
              accountName: names.UK,
              accountNumber: '12345678',
              sortCode: '231470',
              bankName: 'Barclays',
              address: {
                streetAddress: '27 High Street',
                city: 'Leeds',
                state: 'West Yorkshire',
                postcode: 'LS1 4BR',
                countryCode: 'GB',
              },
            })
          : usLocalBeneficiary({
              accountName: names[entity],
              accountNumber: entity === 'SG' ? '778812350' : '778812349',
              routingNumber: '021000021',
              bankName: 'JPMorgan Chase',
              address: {
                streetAddress: '1201 Western Avenue',
                city: 'Seattle',
                state: 'WA',
                postcode: '98101',
                countryCode: 'US',
              },
            });
    const created = await createBeneficiary(client, payload);
    logger.detail('Entity', `${entity} ${names[entity]} → ${created.id}`);
    return created.id;
  };

  const beneficiaryIds = new Map<EntityId, string>();
  for (const entity of ['US', 'DE', 'UK', 'SG'] as const) {
    beneficiaryIds.set(entity, await entityBeneficiary(entity));
  }

  const transfers: TransferRecord[] = [];
  let index = 0;
  for (const entry of settlements) {
    const meta = ENTITY_BENEFICIARY[entry.to];
    const transfer = await advanceTransferToPaid(
      client,
      await createTransfer(client, {
        requestId: ids.forOperation(`net-${index}`),
        transferCurrency: meta.currency,
        transferAmount: entry.amount,
        transferMethod: meta.method,
        reason: TRANSFER_REASONS.goodsPurchased,
        reference: `net settlement ${entry.from}->${entry.to} ${entry.currency}`,
        beneficiaryId: beneficiaryIds.get(entry.to)!,
      }),
    );
    transfers.push(transfer);
    logger.detail(
      'Settled',
      `${entry.from} → ${entry.to} ${formatAmount(entry.amount, entry.currency)} → ${transfer.status}`,
    );
    index += 1;
  }

  logger.chapter('Outcome');
  const unpaid = transfers.filter((entry) => entry.status !== 'PAID');
  if (unpaid.length > 0) {
    throw new Error(`${unpaid.length} net settlements did not reach PAID.`);
  }
  logger.detail(
    'Identity',
    `${INTERCOMPANY_LEGS.length} gross → ${settlements.length} PAID nets + 1 excluded dispute; every currency netted to zero before execution`,
  );
  if (escalationNote) logger.detail('Escalation', escalationNote);

  return {
    grossCount: INTERCOMPANY_LEGS.length,
    netCount: settlements.length,
    settlements,
    transfers,
    ...(escalationNote ? { escalationNote } : {}),
  };
}
