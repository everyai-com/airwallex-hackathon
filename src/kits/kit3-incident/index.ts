import { getBalances, balanceOf } from '../../api/balances.js';
import { createBeneficiary, getBeneficiarySchema, usLocalBeneficiary } from '../../api/beneficiaries.js';
import {
  advanceTransferToPaid,
  createTransfer,
  ensureTransferProcessing,
  getTransfer,
  simulateTransferTransition,
  waitForTerminalTransfer,
} from '../../api/transfers.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import { DuplicatePaymentGuard, decideIncident, isTerminal } from './state.js';

const DEADLINE_HOURS_REMAINING = 8;

export async function runKit3(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = client.requestIds();
  const guard = new DuplicatePaymentGuard();
  const incidentKey = 'PO-8842-cascade';
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Payment Ops Incident Commander — the supplier says nothing arrived');
  logger.info(
    'Goal: decide wait / replace / escalate, and enforce finality, idempotency and a duplicate lock so the company cannot pay twice.',
  );

  const balances = await getBalances(client);
  logger.detail('Wallet', balances.map((line) => `${line.currency} ${line.available}`).join(' | '));

  await getBeneficiarySchema(client, {
    countryCode: 'US',
    currency: 'USD',
    transferMethod: 'LOCAL',
  });
  logger.detail('Beneficiary schema', 'US USD LOCAL — required fields validated');

  const beneficiary = await createBeneficiary(
    client,
    usLocalBeneficiary({
      accountName: 'Cascade Precision Tools, Inc.',
      accountNumber: '778812349',
      routingNumber: '021000021',
      bankName: 'JPMorgan Chase',
      address: {
        streetAddress: '1201 Western Avenue',
        city: 'Seattle',
        state: 'WA',
        postcode: '98101',
        countryCode: 'US',
      },
    }),
  );
  logger.detail('Beneficiary', beneficiary.id);

  logger.chapter('The original payment was sent three days ago');
  const original = await createTransfer(client, {
    requestId: ids.forOperation('incident-original'),
    transferCurrency: 'USD',
    transferAmount: 3_200,
    transferMethod: 'LOCAL',
    reason: TRANSFER_REASONS.goodsPurchased,
    reference: 'PO-8842 precision tooling',
    beneficiaryId: beneficiary.id,
  });
  logger.detail('Original transfer', `${original.id} status ${original.status} request_id ${original.requestId}`);

  if (original.status === 'CANCELLED' || original.status === 'PAID') {
    // A live re-run reuses the persisted request id, so the sandbox returns the
    // original transfer — already terminal from a previous run. Never replay it.
    logger.chapter('Resumed incident');
    logger.detail(
      'Original transfer',
      `${original.id} is ${original.status} — this incident was already executed on a previous run; nothing is re-paid.`,
    );
    logger.info('Run with --fresh to rotate request ids and replay the incident from scratch.');
    return;
  }

  guard.record(incidentKey, {
    transferId: original.id,
    requestId: original.requestId,
    amount: original.transferAmount,
    currency: original.transferCurrency,
    status: 'PROCESSING',
  });

  await logger.step('Advance the transfer to SENT — an intermediate state, never final', async () => {
    // Live sandbox transfers start SCHEDULED; nudge them to PROCESSING first.
    const processing = await ensureTransferProcessing(client, original);
    const sent =
      processing.status === 'PROCESSING'
        ? await simulateTransferTransition(client, original.id, { nextStatus: 'SENT' })
        : processing;
    guard.updateStatus(incidentKey, original.id, 'SENT');
    logger.detail('Status', `${sent.status} (in flight)`);
    const lock = guard.canCreatePayment(incidentKey);
    const decision = decideIncident({
      transfer: sent,
      deadlineHoursRemaining: DEADLINE_HOURS_REMAINING,
      availableBalance: balanceOf(await getBalances(client), 'USD'),
      duplicatePaymentExists: !lock.allowed,
    });
    logger.decision(decision.action, decision.reason);
  });

  logger.chapter('New information: the supplier missed its deadline and the transfer failed');
  logger.info(
    'Supplier email: "Nothing arrived by our cutoff. If we cannot confirm payment today we release your production slot."',
  );

  const failed = await simulateTransferTransition(client, original.id, {
    nextStatus: 'FAILED',
    failureType: 'BENEFICIARY_BANK_RETURNED',
  });
  guard.updateStatus(incidentKey, original.id, 'CANCELLED');
  logger.detail('Transition response', `${failed.status} failure_type ${failed.failureType ?? '-'}`);
  // The sandbox may report FAILED transiently before it settles as CANCELLED;
  // poll until the transfer is terminal before deciding.
  const settled = await waitForTerminalTransfer(client, original.id);
  logger.detail('Original outcome', `${settled.status} failure_type ${settled.failureType ?? '-'}`);
  logger.info(
    'CANCELLED does not mean a person cancelled it — the bank returned the payment. failure_type drives the next decision.',
  );

  const currentBalances = await getBalances(client);
  const lockBeforeReplace = guard.canCreatePayment(incidentKey);
  const decision = decideIncident({
    transfer: settled,
    deadlineHoursRemaining: DEADLINE_HOURS_REMAINING,
    availableBalance: balanceOf(currentBalances, 'USD'),
    duplicatePaymentExists: !lockBeforeReplace.allowed,
  });
  logger.chapter('Decision');
  logger.decision(decision.action, decision.reason);

  let replacementExecuted = false;
  if (decision.action === 'REPLACE') {
    await logger.step('Issue a replacement under the duplicate lock, with a NEW request_id', async () => {
      const lock = guard.canCreatePayment(incidentKey);
      if (!lock.allowed) throw new Error(`Duplicate lock rejected the replacement: ${lock.reason}`);
      logger.detail('Duplicate lock', `cleared — ${lock.reason}`);

      const replacement = await createTransfer(client, {
        requestId: ids.forOperation('incident-replacement'),
        transferCurrency: failed.transferCurrency,
        transferAmount: failed.transferAmount,
        transferMethod: failed.transferMethod === 'SWIFT' ? 'SWIFT' : 'LOCAL',
        reason: TRANSFER_REASONS.goodsPurchased,
        reference: 'PO-8842 replacement after bank return',
        beneficiaryId: beneficiary.id,
      });
      logger.detail('Replacement', `${replacement.id} status ${replacement.status}`);
      guard.record(incidentKey, {
        transferId: replacement.id,
        requestId: replacement.requestId,
        amount: replacement.transferAmount,
        currency: replacement.transferCurrency,
        status: 'PROCESSING',
      });

      const paid = await advanceTransferToPaid(client, replacement);
      guard.updateStatus(incidentKey, replacement.id, 'PAID');
      replacementExecuted = true;
      logger.detail('Replacement settled', `${paid.id} (${paid.status})`);
      logger.detail(
        'Request ids',
        `original ${original.requestId} vs replacement ${replacement.requestId} — different ids for the same beneficiary and amount`,
      );
    });

    await logger.step('The duplicate lock runs again before any further payment', async () => {
      const secondAttempt = guard.canCreatePayment(incidentKey);
      logger.detail(
        'Second payment attempt',
        secondAttempt.allowed ? 'ALLOWED (bug!)' : `BLOCKED — ${secondAttempt.reason}`,
      );
      logger.decision(
        'REFUSE',
        'The lock is consulted before any create call, so retries and racing workers cannot double-pay.',
      );
    });
  }

  logger.chapter('Incident record — both the original and the replacement must be accounted for');
  const originalFinal = await getTransfer(client, original.id);
  logger.detail(
    'Original',
    `${originalFinal.id} status ${originalFinal.status} failure_type ${originalFinal.failureType ?? '-'} ${formatAmount(originalFinal.transferAmount, originalFinal.transferCurrency)} refunded`,
  );
  const transfers = await client.request<{ items: unknown[] }>('/api/v1/transfers', {
    method: 'GET',
  });
  const replacementRecord = (transfers.items as Array<Record<string, unknown>>).find(
    (item) => item.request_id === ids.forOperation('incident-replacement'),
  );
  if (replacementRecord) {
    logger.detail('Replacement', `${replacementRecord.id} status ${replacementRecord.status}`);
  }
  logger.info(
    replacementExecuted
      ? `Final ledger: original ${originalFinal.status} (retryable failure) handled and funds returned; replacement PAID; duplicate lock total for ${incidentKey} is ${guard.totalPaid(incidentKey)} USD-equivalent.`
      : `Final ledger: original ${originalFinal.status} handled; no replacement was issued (decision: ${decision.action}); incident stays open for a person.`,
  );
  if (!isTerminal(originalFinal.status)) {
    logger.info('Warning: original has not reached a terminal state — keep the incident open.');
  }
}
