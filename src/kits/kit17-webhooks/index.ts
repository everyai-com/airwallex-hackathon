import {
  createBeneficiary,
  getBeneficiarySchema,
  usLocalBeneficiary,
} from '../../api/beneficiaries.js';
import {
  addInvoiceLineItems,
  createInvoice,
  ensureBillingCustomer,
  finalizeInvoice,
  getInvoice,
  markInvoicePaid,
} from '../../api/billing.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import {
  advanceTransferToPaid,
  createTransfer,
  getTransfer,
  simulateTransferTransition,
  waitForTerminalTransfer,
} from '../../api/transfers.js';
import { createAnalyst } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import {
  invoiceFinalizedEvent,
  invoicePaidEvent,
  transferFailedEvent,
  transferPaidEvent,
  type WebhookEvent,
} from './events.js';
import {
  decideWebhookReaction,
  type Reaction,
  type ReactionContext,
} from './policy.js';

export interface Kit17Options {
  autoApprove?: boolean;
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface Kit17Result {
  reactions: Reaction[];
  ledger: { eventId: string; kind: string }[];
  escalationNote?: string;
}

const INVOICE_NUMBER = 'K17-1001';

/**
 * Webhook Event Reactor — the payouts loop for platform events: build a payout,
 * a failing transfer and a collection, then handle each delivery exactly once —
 * reconcile paid objects against API state, retry once, escalate the rest.
 */
export async function runKit17(
  client: AirwallexClient,
  logger: Logger,
  options: Kit17Options = {},
): Promise<Kit17Result> {
  const ids = client.requestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ USD: 30_000 });

  logger.chapter('Webhook Event Reactor — observe → decide → act → reconcile');
  logger.info(
    'Goal: handle every platform delivery exactly once — reconcile what paid, retry the retryable failure once, escalate the unknown.',
  );

  logger.chapter('Fixtures — a payout, a failing transfer, a collection');
  await getBeneficiarySchema(client, { countryCode: 'US', currency: 'USD', transferMethod: 'LOCAL' });
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

  const payout = await advanceTransferToPaid(
    client,
    await createTransfer(client, {
      requestId: ids.forOperation('webhook-payout'),
      transferCurrency: 'USD',
      transferAmount: 100,
      transferMethod: 'LOCAL',
      reason: TRANSFER_REASONS.goodsPurchased,
      reference: 'webhook reactor payout',
      beneficiaryId: beneficiary.id,
    }),
  );
  logger.detail('Payout', `${payout.id} ${payout.status}`);

  let failing = await createTransfer(client, {
    requestId: ids.forOperation('webhook-failing'),
    transferCurrency: 'USD',
    transferAmount: 60,
    transferMethod: 'LOCAL',
    reason: TRANSFER_REASONS.goodsPurchased,
    reference: 'webhook reactor failing leg',
    beneficiaryId: beneficiary.id,
  });
  if (failing.status !== 'CANCELLED') {
    failing = await simulateTransferTransition(client, failing.id, {
      nextStatus: 'CANCELLED',
      failureType: 'BENEFICIARY_BANK_RETURNED',
    });
    failing = await waitForTerminalTransfer(client, failing.id);
  }
  logger.detail('Failing leg', `${failing.id} ${failing.status} ${failing.failureType ?? ''}`.trim());

  const customer = await ensureBillingCustomer(client, {
    requestId: ids.forOperation('webhook-customer'),
    name: 'Northwind Traders',
    email: 'webhooks@northwind.example.com',
    currency: 'USD',
  });
  let invoice = await createInvoice(client, {
    requestId: ids.forOperation(`invoice-${INVOICE_NUMBER}`),
    number: INVOICE_NUMBER,
    billingCustomerId: customer.id,
    currency: 'USD',
    daysUntilDue: 30,
    memo: 'Webhook reactor collection.',
  });
  if (invoice.status === 'DRAFT') {
    await addInvoiceLineItems(client, {
      invoiceId: invoice.id,
      requestId: ids.forOperation(`lines-${INVOICE_NUMBER}`),
      lines: [
        {
          description: 'Webhook reactor widgets',
          quantity: 5,
          unitAmount: 500,
          productName: 'Reactor services',
        },
      ],
    });
    invoice = await finalizeInvoice(client, invoice.id);
  } else {
    invoice = await getInvoice(client, invoice.id);
  }
  logger.detail('Invoice', `${invoice.number} ${invoice.status} ${formatAmount(invoice.totalAmount, 'USD')}`);

  const deliveries: WebhookEvent[] = [
    invoiceFinalizedEvent('evt_w1', {
      invoiceId: invoice.id,
      number: invoice.number,
      amount: invoice.totalAmount,
      currency: 'USD',
    }),
    transferPaidEvent('evt_w2', {
      transferId: payout.id,
      requestId: payout.requestId,
      amount: payout.transferAmount,
      currency: 'USD',
    }),
    transferFailedEvent('evt_w3', {
      transferId: failing.id,
      requestId: failing.requestId,
      amount: failing.transferAmount,
      currency: 'USD',
      failureType: failing.failureType ?? 'BENEFICIARY_BANK_RETURNED',
    }),
    // At-least-once redelivery: same id, must not act twice.
    transferPaidEvent('evt_w2', {
      transferId: payout.id,
      requestId: payout.requestId,
      amount: payout.transferAmount,
      currency: 'USD',
    }),
    invoicePaidEvent('evt_w4', {
      invoiceId: invoice.id,
      number: invoice.number,
      amount: invoice.totalAmount,
      currency: 'USD',
    }),
    {
      id: 'evt_w5',
      type: 'risk.hold.created',
      createdAt: new Date().toISOString(),
      data: { reference: payout.id, reason: 'unusual velocity' },
    },
  ];

  logger.chapter('Handle each delivery exactly once');
  const context: ReactionContext = { seenEventIds: new Set(), replacementsUsed: new Map() };
  const reactions: Reaction[] = [];
  const ledger: { eventId: string; kind: string }[] = [];
  let escalationNote: string | undefined;

  for (const event of deliveries) {
    const reaction = decideWebhookReaction(event, context);
    reactions.push(reaction);
    await logger.step(`${event.id} — ${event.type}`, async () => {
      logger.decision(reaction.kind, reaction.reason);
      switch (reaction.kind) {
        case 'DEDUPED':
          logger.detail('Ledger', 'redelivery acknowledged — no state touched');
          break;
        case 'RECONCILE': {
          if (event.type === 'transfer.paid') {
            const current = await getTransfer(client, String(event.data.transfer_id));
            if (current.status !== 'PAID') {
              throw new Error(`Event says PAID but the API reads ${current.status} — refusing to close.`);
            }
            logger.detail('Verified', `${current.id} reads PAID from the API — ledger closed`);
          } else {
            const current = await getInvoice(client, String(event.data.invoice_id));
            if (event.type === 'invoice.payment.paid' && current.paymentStatus !== 'PAID') {
              const account = await ensureGlobalAccount(client, 'USD');
              await simulateDeposit(client, {
                globalAccountId: account.id,
                amount: current.totalAmount,
                payerName: `Northwind Traders ${current.number}`,
              });
              const paid = await markInvoicePaid(client, current.id);
              logger.detail('Collected', `${paid.number} ${formatAmount(paid.totalAmount, 'USD')} → ${paid.paymentStatus}`);
            } else {
              logger.detail('Verified', `${current.number} ${current.status} / ${current.paymentStatus} — recorded`);
            }
          }
          break;
        }
        case 'RETRY': {
          const replacement = await advanceTransferToPaid(
            client,
            await createTransfer(client, {
              requestId: ids.forOperation('webhook-replacement'),
              transferCurrency: 'USD',
              transferAmount: Number(event.data.amount ?? 0),
              transferMethod: 'LOCAL',
              reason: TRANSFER_REASONS.goodsPurchased,
              reference: 'webhook reactor replacement (new request id)',
              beneficiaryId: beneficiary.id,
            }),
          );
          context.replacementsUsed.set(String(event.data.transfer_id), 1);
          logger.detail('Replacement', `${replacement.id} ${replacement.status} — exactly one, new request id`);
          break;
        }
        case 'ESCALATE': {
          const approval = await gate.request({
            operationId: `escalate-${event.id}`,
            summary: `Classify ${event.type} delivery ${event.id}`,
            amount: 0,
            currency: 'USD',
            counterparty: 'webhook platform',
            evidence: [reaction.reason],
          });
          escalationNote = await analyst.explainException({
            counterparty: 'webhook platform',
            amount: 0,
            currency: 'USD',
            reason: reaction.reason,
          });
          logger.decision(
            approval.approved ? 'ESCALATED' : 'HELD',
            `${escalationNote} Approved by ${approval.approver}.`,
          );
          break;
        }
        case 'ACK':
          logger.detail('Ledger', 'acknowledged — no state to move');
          break;
      }
      context.seenEventIds.add(event.id);
      ledger.push({ eventId: event.id, kind: reaction.kind });
    });
  }

  logger.chapter('Outcome');
  const unique = new Set(deliveries.map((entry) => entry.id));
  if (context.seenEventIds.size !== unique.size) {
    throw new Error('Ledger missed a delivery id.');
  }
  const kinds = reactions.map((entry) => entry.kind).sort().join(',');
  if (kinds !== 'DEDUPED,ESCALATE,RECONCILE,RECONCILE,RECONCILE,RETRY') {
    throw new Error(`Unexpected reaction mix: ${kinds}.`);
  }
  for (const entry of ledger) logger.detail(entry.eventId, entry.kind);
  logger.detail('Identity', '6 deliveries, 5 unique ids, 1 deduped, 1 retried, 1 escalated — each exactly once');
  if (escalationNote) logger.detail('Escalation', escalationNote);

  return {
    reactions,
    ledger,
    ...(escalationNote ? { escalationNote } : {}),
  };
}
