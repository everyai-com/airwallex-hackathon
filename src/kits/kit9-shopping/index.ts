import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import { buildCatalog, offersFrom, type PurchaseOffer } from '../commerce-catalog.js';
import {
  MerchantService,
  signTapCompletionProof,
  type AiriReport,
  type MerchantOrder,
} from '../commerce-merchant.js';
import {
  generateTapAgent,
  TapAgentRegistry,
  TapReplayGuard,
  tapAgentRegistryEntry,
} from '../../core/tap.js';
import {
  AiriReportGuard,
  fingerprintChanges,
  offerFingerprint,
  rankOffers,
  type OfferEvaluation,
  type RecordedAttempt,
} from './policy.js';
import { AIRI_SHOPPER_EMAIL, BACKORDER_NOTE, FIRST_SEARCH, PROCUREMENT_REQUEST } from './scenario.js';

export interface Kit9Options {
  autoApprove?: boolean;
}

export interface Kit9ApprovalRecord {
  stage: 'INITIAL' | 'FRESH';
  fingerprint: string;
  merchant: string;
  amountUsd: number;
  approved: boolean;
  changedFromPrevious: string[];
}

export interface Kit9Result {
  order: MerchantOrder;
  approvals: Kit9ApprovalRecord[];
  attempts: RecordedAttempt[];
  reports: AiriReport[];
  tap: { agentId: string; verified: boolean };
}

/**
 * Approval-Bound Shopping Agent: searches the merchant network, binds an
 * approval to product + merchant + total + fulfillment, re-approves when the
 * deal materially changes, and pays with Airi one-click — reporting every
 * result before any retry.
 */
export async function runKit9(
  client: AirwallexClient,
  logger: Logger,
  options: Kit9Options = {},
): Promise<Kit9Result> {
  const ids = client.requestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const tapAgent = generateTapAgent({ agentId: 'approval-bound-shopper' });
  const tapRegistry = new TapAgentRegistry();
  tapRegistry.register(tapAgentRegistryEntry(tapAgent));
  const merchant = new MerchantService(client, { tap: { registry: tapRegistry, replayGuard: new TapReplayGuard() } });
  merchant.loadCatalog(buildCatalog());

  const mission = {
    budgetUsd: PROCUREMENT_REQUEST.budgetUsd,
    deadlineDays: PROCUREMENT_REQUEST.deadlineDays,
    quantity: PROCUREMENT_REQUEST.quantity,
  };

  logger.chapter('Approval-Bound Shopping Agent — a fresh approval whenever the deal changes');
  logger.info(`Goal: ${PROCUREMENT_REQUEST.goal} ${PROCUREMENT_REQUEST.constraint}`);
  logger.detail('Catalog', `${merchant.getCatalog().length} listings on the sandbox merchant network`);

  const firstSearch = merchant.search({
    text: FIRST_SEARCH,
    inStockOnly: true,
    sort: 'rating_desc',
    pageSize: 25,
  });
  logger.detail(
    'Product search',
    `"${FIRST_SEARCH}" -> ${firstSearch.total} listings (page ${firstSearch.page}/${firstSearch.totalPages})`,
  );

  const firstEvaluation = rankOffers(
    offersFrom(firstSearch.items, mission.quantity),
    mission,
  );
  printOffers(logger, firstEvaluation);
  const chosen1 = firstEvaluation.chosen;
  if (!chosen1) throw new Error('No offer fits the shopping mission.');

  logger.decision(
    'CHOOSE',
    `${chosen1.name} from ${chosen1.merchant} — ${formatAmount(chosen1.totalUsd, 'USD')} delivered, ${chosen1.shippingCode} in ${chosen1.etaDays} days`,
  );

  const firstFingerprint = offerFingerprint(chosen1);
  const firstApproval = await gate.request({
    operationId: 'kit9-purchase',
    summary: `Buy ${chosen1.name} from ${chosen1.merchant}`,
    amount: chosen1.totalUsd,
    currency: chosen1.currency,
    counterparty: chosen1.merchant,
    evidence: approvalEvidence(chosen1, firstFingerprint),
  });
  const approvals: Kit9ApprovalRecord[] = [
    {
      stage: 'INITIAL',
      fingerprint: firstFingerprint,
      merchant: chosen1.merchant,
      amountUsd: chosen1.totalUsd,
      approved: firstApproval.approved,
      changedFromPrevious: [],
    },
  ];
  if (!firstApproval.approved) {
    throw new Error(
      'The purchase was denied at the approval gate; the request stays with a person and no money moves.',
    );
  }
  logger.detail('Approval', `APPROVED by ${firstApproval.approver}`);
  logger.detail(
    'Bound to',
    `${chosen1.sku} | ${chosen1.merchant} | ${formatAmount(chosen1.totalUsd, 'USD')} | ${chosen1.shippingCode}`,
  );

  logger.chapter('New information: the merchant feed contradicts the chosen listing');
  logger.info(`${BACKORDER_NOTE.from}: "${BACKORDER_NOTE.body}"`);
  merchant.setAvailability(BACKORDER_NOTE.affectedSku, false);

  const secondSearch = merchant.search({
    text: FIRST_SEARCH,
    inStockOnly: true,
    sort: 'rating_desc',
    pageSize: 25,
  });
  const secondEvaluation = rankOffers(
    offersFrom(secondSearch.items, mission.quantity),
    mission,
  );
  const chosen2 = secondEvaluation.chosen;
  if (!chosen2) throw new Error('No offer fits the shopping mission after the backorder.');

  const changes = fingerprintChanges(firstFingerprint, chosen2);
  if (changes.length === 0) {
    throw new Error('The backorder did not materially change the deal; the demo scenario drifted.');
  }
  logger.decision(
    'RE-PLAN',
    `${chosen2.name} from ${chosen2.merchant} — ${formatAmount(chosen2.totalUsd, 'USD')} delivered (${chosen2.shippingCode} in ${chosen2.etaDays} days)`,
  );
  logger.decision(
    'FRESH APPROVAL REQUIRED',
    `The approval covered ${firstFingerprint}; the deal now differs in ${changes.length} dimension(s): ${changes.join(', ')}.`,
  );

  const secondFingerprint = offerFingerprint(chosen2);
  const secondApproval = await gate.request({
    operationId: 'kit9-purchase-reapproved',
    summary: `Buy ${chosen2.name} from ${chosen2.merchant} (revised after the backorder)`,
    amount: chosen2.totalUsd,
    currency: chosen2.currency,
    counterparty: chosen2.merchant,
    evidence: approvalEvidence(chosen2, secondFingerprint),
  });
  approvals.push({
    stage: 'FRESH',
    fingerprint: secondFingerprint,
    merchant: chosen2.merchant,
    amountUsd: chosen2.totalUsd,
    approved: secondApproval.approved,
    changedFromPrevious: changes,
  });
  if (!secondApproval.approved) {
    throw new Error(
      'The revised purchase was denied at the approval gate; the agent stops before checkout.',
    );
  }
  logger.detail('Fresh approval', `APPROVED by ${secondApproval.approver}`);
  logger.detail('Re-bound to', `${chosen2.sku} | ${chosen2.merchant} | ${formatAmount(chosen2.totalUsd, 'USD')} | ${chosen2.shippingCode}`);

  logger.chapter('Checkout — the merchant snapshots price and fulfillment');
  const checkout = merchant.createCheckout({
    requestId: ids.forOperation('kit9-checkout'),
    items: [{ sku: chosen2.sku, quantity: mission.quantity, shippingCode: chosen2.shippingCode }],
    customerEmail: 'office@acme-demo.example',
    successUrl: 'https://acme-demo.example/orders/thanks',
  });
  logger.detail(
    'Checkout',
    `${checkout.id} ${checkout.status} — ${formatAmount(checkout.totalUsd, 'USD')} (${checkout.currency})`,
  );
  logger.detail('Hosted page', checkout.url);
  logger.detail('Expires', checkout.expiresAt);
  if (checkout.totalUsd !== chosen2.totalUsd) {
    throw new Error(
      `Approved ${chosen2.totalUsd} but the checkout quoted ${checkout.totalUsd}; refusing to pay a total the approver never saw.`,
    );
  }
  logger.decision(
    'BINDING CHECK',
    `Approved total ${formatAmount(chosen2.totalUsd, 'USD')} equals the checkout total; the agent pays exactly what was approved.`,
  );

  logger.chapter('Payment — Airi one-click, every result reported before a retry');
  const guard = new AiriReportGuard();
  logger.detail(
    'TAP identity',
    `Shopper agent ${tapAgent.agentId} signs every completion (Visa TAP); the merchant verifies before charging.`,
  );

  const attempt1RequestId = ids.fresh();
  const attempt1 = await merchant.completeCheckout({
    checkoutId: checkout.id,
    requestId: attempt1RequestId,
    payment: { type: 'airi', email: AIRI_SHOPPER_EMAIL },
    simulateFailureReason: 'AUTHENTICATION_EXPIRED',
    tap: signTapCompletionProof({ agent: tapAgent, checkoutId: checkout.id, requestId: attempt1RequestId, paymentType: 'airi' }),
  });
  if (attempt1.ok) throw new Error('Expected the first Airi attempt to be declined.');
  const attempt1Id = attempt1.paymentIntentId ?? attempt1RequestId;
  guard.recordAttempt({
    id: attempt1Id,
    requestId: attempt1RequestId,
    status: 'DECLINED',
    ...(attempt1.failureReason ? { failureReason: attempt1.failureReason } : {}),
  });
  logger.detail('Attempt 1', `DECLINED — ${attempt1.failureReason ?? attempt1.code}`);
  logger.detail('Payment intent', `${attempt1.paymentIntentId ?? 'n/a'} FAILED`);

  const blockedRetry = guard.canRetry();
  if (blockedRetry.allowed) throw new Error('The retry guard should require a report first.');
  logger.decision('RETRY BLOCKED', blockedRetry.reason);
  logger.info('  (no second Airi call was made; the failure must be on record first)');

  const report1 = merchant.reportToAiri({
    checkoutId: checkout.id,
    requestId: attempt1RequestId,
    result: 'DECLINED',
    ...(attempt1.failureReason ? { reason: attempt1.failureReason } : {}),
  });
  guard.report(attempt1Id);
  logger.detail('Reported to Airi', `${report1.id} — DECLINED (${report1.reason ?? 'no reason'})`);

  const attempt2RequestId = ids.fresh();
  const attempt2 = await merchant.completeCheckout({
    checkoutId: checkout.id,
    requestId: attempt2RequestId,
    payment: { type: 'airi', email: AIRI_SHOPPER_EMAIL },
    tap: signTapCompletionProof({ agent: tapAgent, checkoutId: checkout.id, requestId: attempt2RequestId, paymentType: 'airi' }),
  });
  if (!attempt2.ok) throw new Error(`The Airi retry failed: ${attempt2.detail}`);
  const order = attempt2.order;
  guard.recordAttempt({
    id: order.paymentIntentId,
    requestId: attempt2RequestId,
    status: 'SUCCEEDED',
  });
  const report2 = merchant.reportToAiri({
    checkoutId: checkout.id,
    requestId: attempt2RequestId,
    result: 'SUCCEEDED',
  });
  guard.report(order.paymentIntentId);
  logger.detail('Attempt 2', `SUCCEEDED — order ${order.merchantOrderNumber}`);
  logger.detail('Reported to Airi', `${report2.id} — SUCCEEDED`);
  const retryCheck = guard.canRetry();
  logger.detail('Retry check', retryCheck.allowed ? 'nothing unreported' : retryCheck.reason);

  logger.chapter('Outcome');
  logger.detail('Order', `${order.merchantOrderNumber} ${order.status} — ${formatAmount(order.totalUsd, 'USD')}`);
  logger.detail('Checkout', `${checkout.id} ${checkout.status}`);
  logger.detail(
    'Approved vs executed',
    `${formatAmount(chosen2.totalUsd, 'USD')} approved = ${formatAmount(order.totalUsd, 'USD')} executed`,
  );
  logger.detail(
    'Constraint check',
    `${formatAmount(order.totalUsd, 'USD')} <= ${formatAmount(mission.budgetUsd, 'USD')} budget; ${chosen2.shippingCode} ${chosen2.etaDays} days <= ${mission.deadlineDays}-day deadline`,
  );

  logger.chapter('Decision ledger');
  for (const record of approvals) {
    logger.detail(
      `APPROVAL · ${record.stage}`,
      `${record.fingerprint} — ${record.approved ? 'approved' : 'denied'}${record.changedFromPrevious.length > 0 ? ` (changed: ${record.changedFromPrevious.join(', ')})` : ''}`,
    );
  }
  for (const report of [report1, report2]) {
    logger.detail(`REPORT · ${report.result}`, `${report.id} — ${report.requestId}${report.reason ? ` (${report.reason})` : ''}`);
  }
  logger.detail('ORDER', `${order.merchantOrderNumber} · ${formatAmount(order.totalUsd, 'USD')} · intent ${order.paymentIntentId}`);
  logger.info(
    'Had the fresh approval been denied, the agent would have stopped before checkout — no money moves without a person clearing the new deal.',
  );

  return {
    order,
    approvals,
    attempts: guard.history(),
    reports: [report1, report2],
    tap: { agentId: tapAgent.agentId, verified: true },
  };
}

function approvalEvidence(offer: PurchaseOffer, fingerprint: string): string[] {
  return [
    `Product: ${offer.name} (${offer.sku})`,
    `Merchant: ${offer.merchant}`,
    `Delivered total: ${formatAmount(offer.totalUsd, 'USD')} — ${offer.shippingCode} in ${offer.etaDays} days`,
    `Binding: ${fingerprint}`,
    `Constraint: within ${formatAmount(PROCUREMENT_REQUEST.budgetUsd, 'USD')} delivered and arriving by Friday`,
  ];
}

function printOffers(logger: Logger, evaluation: OfferEvaluation): void {
  for (const entry of evaluation.considered) {
    const tag = !entry.eligible
      ? 'REJECTED'
      : entry.offer === evaluation.chosen
        ? 'CHOSEN'
        : 'RUNNER-UP';
    logger.detail(
      `${tag} · ${entry.offer.merchant}`,
      `${entry.offer.name} — ${formatAmount(entry.offer.totalUsd, 'USD')} | ${entry.offer.shippingCode} ${entry.offer.etaDays}d | ${entry.reason}`,
    );
  }
}
