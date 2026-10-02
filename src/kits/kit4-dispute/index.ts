import { uploadEvidence } from '../../api/files.js';
import {
  acceptPaymentDispute,
  challengePaymentDispute,
  confirmPaymentIntent,
  createPaymentIntent,
  escalatePaymentDispute,
  listPaymentDisputes,
  listRefunds,
  simulatePaymentDispute,
} from '../../api/payments.js';
import type { AirwallexClient } from '../../core/client.js';
import { isAirwallexError } from '../../core/errors.js';
import { RequestIds } from '../../core/ids.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import { DISPUTE_CASES, DISPUTE_FEE_USD, TEST_CARD, type DisputeCase } from './cases.js';
import { buildPdfEvidence } from './evidence.js';
import { decideAfterRejection, decideDispute, type DisputeDecision } from './policy.js';

const ARBITRATION_COST_USD = 500;

export async function runKit4(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = new RequestIds();

  logger.chapter('Dispute Response Agent — three chargebacks, three different economics');
  logger.info(
    `Goal: accept, challenge or escalate each case. The dispute fee is configured at USD ${DISPUTE_FEE_USD} because the sandbox does not deduct it, and it is charged even when we win.`,
  );

  logger.chapter('Create and confirm three payments with the sandbox test card');
  const disputesByCase = new Map<string, string>();
  for (const disputeCase of DISPUTE_CASES) {
    const intent = await createPaymentIntent(client, {
      requestId: ids.forOperation(`intent-${disputeCase.id}`),
      amount: disputeCase.amount,
      currency: disputeCase.currency,
      merchantOrderId: disputeCase.merchantOrderId,
      descriptor: 'ACME Demo Store',
    });
    const confirmed = await confirmPaymentIntent(client, {
      intentId: intent.id,
      requestId: ids.forOperation(`confirm-${disputeCase.id}`),
      card: TEST_CARD,
    });
    const dispute = await simulatePaymentDispute(client, {
      paymentIntentId: intent.id,
      stage: 'RFI',
      reasonCode: disputeCase.reasonCode,
      amount: disputeCase.amount,
      dueAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      comment: disputeCase.comment,
    });
    disputesByCase.set(disputeCase.id, dispute.id);
    logger.detail(
      disputeCase.merchantOrderId,
      `${confirmed.status} — dispute ${dispute.id} staged at ${dispute.stage}`,
    );
  }

  logger.chapter('Read the queue: amounts, reason codes and deadlines make the economics');
  const queue = await listPaymentDisputes(client);
  for (const dispute of queue) {
    logger.detail(
      dispute.id,
      `${formatAmount(dispute.amount, dispute.currency)} code ${dispute.reasonCode} (${dispute.reasonType}) stage ${dispute.stage} status ${dispute.status} due ${dispute.dueAt ?? '-'}`,
    );
  }

  const decisions = new Map<string, DisputeDecision>();
  logger.chapter('Decisions');
  for (const disputeCase of DISPUTE_CASES) {
    const decision = decideDispute(disputeCase, DISPUTE_FEE_USD);
    decisions.set(disputeCase.id, decision);
    logger.decision(`${decision.action} ${disputeCase.merchantOrderId}`, decision.reason);
  }

  const smallCase = byId('case-not-received-small');
  const smallDecision = decisions.get(smallCase.id)!;
  const smallDisputeId = disputesByCase.get(smallCase.id)!;
  await logger.step(`Accept ${smallCase.merchantOrderId} — the fee exceeds the amount at risk`, async () => {
    const accepted = await acceptPaymentDispute(client, {
      disputeId: smallDisputeId,
      requestId: ids.forOperation(`accept-${smallCase.id}`),
      reason: smallDecision.acceptReason ?? 'LOW_VALUE_TRANSACTION',
      description: `Accepted automatically: ${smallDecision.reason}`,
    });
    logger.detail('Dispute status', `${accepted.status} at ${accepted.stage}`);
  });

  const fraudCase = byId('case-fraud-large');
  const fraudDecision = decisions.get(fraudCase.id)!;
  const fraudDisputeId = disputesByCase.get(fraudCase.id)!;
  await logger.step(`Challenge ${fraudCase.merchantOrderId} with uploaded evidence`, async () => {
    const documents = await Promise.all([
      uploadEvidence(client, {
        filename: 'order-confirmation.pdf',
        contentType: 'application/pdf',
        notes: 'Order snapshot',
        content: buildPdfEvidence('Order confirmation', [
          `Order ${fraudCase.merchantOrderId}`,
          `Customer: ${fraudCase.customer.name} <${fraudCase.customer.email}>`,
          `Amount: USD ${fraudCase.amount}`,
          'Purchased: precision tooling set',
        ]),
      }),
      uploadEvidence(client, {
        filename: 'signed-delivery-receipt.pdf',
        contentType: 'application/pdf',
        notes: 'Signed delivery receipt',
        content: buildPdfEvidence('Proof of delivery', [
          `Tracking 1Z999AA10123456784 delivered for order ${fraudCase.merchantOrderId}`,
          'Recipient signature captured on handheld device at 14:32 local time',
          'GPS coordinates match billing city on file',
        ]),
      }),
      uploadEvidence(client, {
        filename: 'device-ip-history.pdf',
        contentType: 'application/pdf',
        notes: 'Device and IP history',
        content: buildPdfEvidence('Device and IP history', [
          `Device ${fraudCase.customer.deviceId}`,
          `IP ${fraudCase.customer.ip}`,
          'Matches 3 prior undisputed orders on the same account',
          'No account takeover indicators across those sessions',
        ]),
      }),
    ]);
    logger.detail(
      'Evidence uploaded',
      documents.map((document) => document.fileId).join(', ') + ' (PDF only — PNG is rejected)',
    );

    const challenged = await challengePaymentDispute(client, {
      disputeId: fraudDisputeId,
      requestId: ids.forOperation(`challenge-${fraudCase.id}`),
      reason: fraudDecision.challengeReason ?? 'PRODUCT_RECEIVED',
      productType: 'PHYSICAL_GOODS',
      productDescription: 'Precision tooling set',
      customerInfo: {
        name: fraudCase.customer.name,
        email: fraudCase.customer.email,
        ip: fraudCase.customer.ip,
        device_id: fraudCase.customer.deviceId,
        billing_address: fraudCase.customer.billingAddress,
      },
      deliveryInfo: {
        shipped_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        delivered_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        status: 'DELIVERED',
        tracking_number: '1Z999AA10123456784',
        shipping_company: 'UPS',
      },
      supportingDocuments: [
        { type: 'ORDER', file_ids: [documents[0]!.fileId] },
        { type: 'PRIMARY', file_ids: [documents[1]!.fileId] },
        { type: 'CUSTOMER', file_ids: [documents[2]!.fileId] },
      ],
    });
    logger.detail('Dispute status', `${challenged.status} at ${challenged.stage}`);
  });

  logger.chapter('The issuing bank rejects the evidence');
  const escalated = await escalatePaymentDispute(client, {
    disputeId: fraudDisputeId,
    dueAt: new Date(Date.now() + 96 * 3_600_000).toISOString(),
    comment: 'The evidence does not prove the payment is valid. Please submit further documents.',
  });
  logger.detail('After escalation', `stage ${escalated.stage} status ${escalated.status}`);

  await logger.step('Attempt to escalate again from CHARGEBACK — the API forbids it', async () => {
    try {
      await escalatePaymentDispute(client, { disputeId: fraudDisputeId });
      logger.detail('Second escalation', 'unexpectedly accepted');
    } catch (error) {
      if (isAirwallexError(error)) {
        logger.detail('Rejected as expected', `${error.code} | ${error.message}`);
        logger.decision('STATE MACHINE', 'Escalate only from a challenged dispute; CHARGEBACK cannot escalate again.');
      } else {
        throw error;
      }
    }
  });

  const afterRejection = decideAfterRejection(fraudCase, ARBITRATION_COST_USD);
  logger.decision(`Re-evaluate ${fraudCase.merchantOrderId}`, afterRejection.reason);
  if (afterRejection.action === 'ACCEPT') {
    await logger.step('Accept the chargeback after the rejection', async () => {
      const accepted = await acceptPaymentDispute(client, {
        disputeId: fraudDisputeId,
        requestId: ids.forOperation(`accept-after-rejection-${fraudCase.id}`),
        reason: afterRejection.acceptReason ?? 'VALID_CUSTOMER_DISPUTE',
        description: afterRejection.reason,
      });
      logger.detail('Dispute status', `${accepted.status} at ${accepted.stage}`);
    });
  }

  const creditCase = byId('case-credit-not-processed');
  const creditDecision = decisions.get(creditCase.id)!;
  logger.chapter('Internal escalation — fixing our own failure');
  logger.decision(`ESCALATE ${creditCase.merchantOrderId}`, creditDecision.reason);
  logger.detail(
    'Ticket queued',
    `Refund USD ${creditCase.amount} to ${creditCase.customer.email}, fix the credit that support never processed, then respond to the dispute before its due date.`,
  );

  logger.chapter('Outcome');
  const finalQueue = await listPaymentDisputes(client);
  for (const dispute of finalQueue) {
    logger.detail(dispute.id, `${dispute.stage} — ${dispute.status}`);
  }
  const refunds = await listRefunds(client);
  const refunded = refunds.reduce((total, refund) => total + Number(refund.amount ?? 0), 0);
  logger.detail('Refunds created', `${refunds.length} totalling USD ${refunded}`);
  logger.info(
    'Net result: one defended claim (escalated, then accepted at CHARGEBACK), one low-value accept, one internal remediation opened — every decision bounded by the dispute fee.',
  );
}

function byId(id: string): DisputeCase {
  const found = DISPUTE_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown dispute case ${id}`);
  return found;
}
