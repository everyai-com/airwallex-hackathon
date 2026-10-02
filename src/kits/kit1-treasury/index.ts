import { getBalances } from '../../api/balances.js';
import {
  createBeneficiary,
  euSwiftBeneficiary,
  gbLocalBeneficiary,
  getBeneficiarySchema,
  usLocalBeneficiary,
} from '../../api/beneficiaries.js';
import { createFxConversion, createFxQuote, getFxRate } from '../../api/fx.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { createTransfer, simulateTransferTransition } from '../../api/transfers.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import { RequestIds } from '../../core/ids.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2, roundTo } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import { planTreasury, usdValueOf, amountWithFee } from './planner.js';
import { TREASURY_POLICY } from './policy.js';
import { CONTRADICTING_EMAIL, TREASURY_FORECAST, TREASURY_OBLIGATIONS } from './scenario.js';
import type { BeneficiaryProfile, Obligation, PlannerResult } from './types.js';

export interface Kit1Options {
  autoApprove?: boolean;
  depositUsd?: number;
}

export async function runKit1(
  client: AirwallexClient,
  logger: Logger,
  options: Kit1Options = {},
): Promise<void> {
  const ids = new RequestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const executedObligationIds: string[] = [];
  const approvedObligationIds: string[] = [];
  let forecast = { ...TREASURY_FORECAST };

  client.seedMockBalances({ USD: 14_200, EUR: 1_150, GBP: 400 });

  logger.chapter('Adaptive Treasury Controller — five obligations, 72 hours, three currencies');
  logger.info(
    'Goal: fund what keeps the business running, preserve the reserve floor, and escalate what policy forbids.',
  );

  const usdValue = await readUsdValues(client);
  let balances = await readBalances(client);
  logger.detail('Wallet', formatWallet(balances));
  logger.detail('FX to USD', `EUR ${usdValue.EUR} | GBP ${usdValue.GBP}`);
  logger.detail('Reserve floor', `USD ${TREASURY_POLICY.reserveFloorUsd}`);
  logger.detail(
    'Obligations',
    TREASURY_OBLIGATIONS.map((o) => `${o.id} ${formatAmount(o.amount, o.currency)}`).join(', '),
  );

  const plan1 = planTreasury({
    balances,
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast,
    policy: TREASURY_POLICY,
  });
  logger.chapter('Initial plan');
  printPlan(logger, plan1, forecast.confidence);

  await logger.step('Execute the critical, fully funded obligation: Meridian Freight', async () => {
    const shipping = obligation('obl-shipping');
    const beneficiaryId = await ensureBeneficiary(client, shipping.beneficiary, logger);
    const transfer = await createTransfer(client, {
      requestId: ids.forOperation('obl-shipping-transfer'),
      transferCurrency: shipping.currency,
      transferAmount: shipping.amount,
      transferMethod: shipping.transferMethod,
      reason: TRANSFER_REASONS.freight,
      reference: 'INV-MF-8891 ocean freight',
      beneficiaryId,
    });
    logger.detail('Transfer created', `${transfer.id} (${transfer.status})`);
    await simulateTransferTransition(client, transfer.id, { nextStatus: 'SENT' });
    const paid = await simulateTransferTransition(client, transfer.id, { nextStatus: 'PAID' });
    logger.detail('Transfer settled', `${paid.id} (${paid.status}) ${formatAmount(shipping.amount, shipping.currency)}`);
    executedObligationIds.push(shipping.id);
  });

  balances = await readBalances(client);

  logger.chapter('New information: a customer email contradicts the receipt forecast');
  logger.info(`Email from ${CONTRADICTING_EMAIL.from}: "${CONTRADICTING_EMAIL.body}"`);
  forecast = {
    ...forecast,
    confidence: 0.42,
    contradictingEvidence: CONTRADICTING_EMAIL.body,
  };
  logger.detail('Forecast confidence', `${TREASURY_FORECAST.confidence} -> ${forecast.confidence}`);
  logger.detail(
    'Autonomous limit',
    `USD ${TREASURY_POLICY.commitmentLimitUsd(TREASURY_FORECAST.confidence)} -> USD ${TREASURY_POLICY.commitmentLimitUsd(forecast.confidence)}`,
  );

  const plan2 = planTreasury({
    balances,
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast,
    policy: TREASURY_POLICY,
    executedObligationIds,
    approvedObligationIds,
  });
  logger.chapter('Re-planned after the email — only confidence-dependent decisions change');
  printPlan(logger, plan2, forecast.confidence);

  const needsApproval = plan2.actions.find(
    (action) => action.kind === 'REQUIRE_APPROVAL' && action.obligation.id === 'obl-parts',
  );
  if (needsApproval && needsApproval.kind === 'REQUIRE_APPROVAL') {
    const parts = needsApproval.obligation;
    const approval = await gate.request({
      operationId: parts.id,
      summary: `Convert USD to EUR and pay ${parts.counterparty}`,
      amount: round2(amountWithFee(parts) - (balances[parts.currency] ?? 0)),
      currency: parts.currency,
      counterparty: parts.counterparty,
      evidence: [
        ...forecast.evidence,
        `Contradicting email: ${forecast.contradictingEvidence}`,
        `Invoice ${parts.description}`,
      ],
    });
    logger.chapter('Human approval gate');
    logger.detail('Operation', parts.counterparty);
    logger.detail('Bound amount', `${approval.request.amount} ${approval.request.currency}`);
    logger.detail('Approved by', approval.approver);
    if (approval.approved) approvedObligationIds.push(parts.id);
    else logger.info('Approval declined — the conversion stays parked for a person to revisit.');
  }

  const depositUsd = options.depositUsd ?? TREASURY_FORECAST.amount;
  await logger.step(`The forecast receipt lands: simulate a USD ${depositUsd} deposit`, async () => {
    const account = await ensureGlobalAccount(client, 'USD');
    const deposit = await simulateDeposit(client, {
      globalAccountId: account.id,
      amount: depositUsd,
      payerName: TREASURY_FORECAST.payer,
    });
    logger.detail('Deposit', `${deposit.id} reports ${deposit.status} — balance posts immediately`);
  });

  balances = await readBalances(client);
  logger.detail('Wallet after deposit', formatWallet(balances));

  const plan3 = planTreasury({
    balances,
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast,
    policy: TREASURY_POLICY,
    executedObligationIds,
    approvedObligationIds,
  });
  logger.chapter('Recalculated — only decisions the new cash changes are reopened');
  printPlan(logger, plan3, forecast.confidence);

  const convertAction = plan3.actions.find(
    (action) => action.kind === 'CONVERT_AND_FUND' && action.obligation.id === 'obl-parts',
  );
  if (convertAction && convertAction.kind === 'CONVERT_AND_FUND') {
    const parts = convertAction.obligation;
    await logger.step(`Convert the minimum: USD -> EUR ${convertAction.convertAmount}`, async () => {
      const quote = await createFxQuote(client, {
        requestId: ids.forOperation('obl-parts-quote'),
        sellCurrency: convertAction.sellCurrency,
        buyCurrency: convertAction.buyCurrency,
        buyAmount: convertAction.convertAmount,
      });
      logger.detail('Fresh quote', `${quote.id} at ${quote.rate} (single use)`);

      const conversion = await createFxConversion(client, {
        requestId: ids.forOperation('obl-parts-conversion'),
        sellCurrency: convertAction.sellCurrency,
        buyCurrency: convertAction.buyCurrency,
        buyAmount: convertAction.convertAmount,
        quoteId: quote.id,
      });
      logger.detail(
        'Conversion',
        `${conversion.conversionId} ${conversion.status} — sold ${formatAmount(conversion.sellAmount, 'USD')} for ${formatAmount(conversion.buyAmount, 'EUR')} at ${conversion.rate}`,
      );
      logger.decision('FX', 'FX calls carry no x-api-version header; the quote is booked exactly once');
    });

    await logger.step(`Pay ${parts.counterparty} with the converted funds`, async () => {
      const beneficiaryId = await ensureBeneficiary(client, parts.beneficiary, logger);
      const transfer = await createTransfer(client, {
        requestId: ids.forOperation('obl-parts-transfer'),
        transferCurrency: parts.currency,
        transferAmount: parts.amount,
        transferMethod: parts.transferMethod,
        reason: TRANSFER_REASONS.goodsPurchased,
        reference: 'INV-STK-2044 CNC components',
        beneficiaryId,
      });
      logger.detail('Transfer created', `${transfer.id} (${transfer.status})`);
      await simulateTransferTransition(client, transfer.id, { nextStatus: 'SENT' });
      const paid = await simulateTransferTransition(client, transfer.id, { nextStatus: 'PAID' });
      logger.detail(
        'Transfer settled',
        `${paid.id} (${paid.status}) ${formatAmount(parts.amount, parts.currency)} + EUR 12.85 SWIFT fee`,
      );
      executedObligationIds.push(parts.id);
    });
  }

  const finalBalances = await readBalances(client);
  const reserveUsd = round2(
    Object.entries(finalBalances).reduce(
      (total, [currency, amount]) => total + usdValueOf(amount, currency, usdValue),
      0,
    ),
  );

  logger.chapter('Outcome');
  logger.detail('Final wallet', formatWallet(finalBalances));
  logger.detail('Reserve (USD equivalent)', `USD ${reserveUsd}`);
  logger.detail(
    'Reserve floor',
    `USD ${TREASURY_POLICY.reserveFloorUsd} — ${reserveUsd >= TREASURY_POLICY.reserveFloorUsd ? 'maintained' : 'BELOW FLOOR'}`,
  );
  for (const action of plan3.actions) {
    if (action.kind === 'DEFER') {
      logger.detail('Deferred', `${action.obligation.counterparty} — ${action.reason}`);
    }
    if (action.kind === 'ESCALATE') {
      logger.detail('Escalated', `${action.obligation.counterparty} — ${action.reason}`);
    }
  }
  logger.info(
    'Executed: Meridian Freight (USD 4,200) and Steinmetz Komponenten (EUR 5,400 + fee) under the recorded approval; Lowly Software and Anker Strategy stay deferred; Helios Advisory awaits vendor onboarding.',
  );
}

async function readBalances(client: AirwallexClient): Promise<Record<string, number>> {
  const lines = await getBalances(client);
  return Object.fromEntries(lines.map((line) => [line.currency, line.available]));
}

async function readUsdValues(client: AirwallexClient): Promise<Record<string, number>> {
  const [eur, gbp] = await Promise.all([
    getFxRate(client, { sellCurrency: 'USD', buyCurrency: 'EUR' }),
    getFxRate(client, { sellCurrency: 'USD', buyCurrency: 'GBP' }),
  ]);
  return {
    USD: 1,
    EUR: roundTo(1 / eur, 6),
    GBP: roundTo(1 / gbp, 6),
  };
}

async function ensureBeneficiary(
  client: AirwallexClient,
  profile: BeneficiaryProfile,
  logger: Logger,
): Promise<string> {
  const corridor =
    profile.kind === 'us-local'
      ? { countryCode: 'US', currency: 'USD', transferMethod: 'LOCAL' as const }
      : profile.kind === 'gb-local'
        ? { countryCode: 'GB', currency: 'GBP', transferMethod: 'LOCAL' as const }
        : { countryCode: 'DE', currency: 'EUR', transferMethod: 'SWIFT' as const };
  await getBeneficiarySchema(client, corridor);
  logger.detail('Beneficiary schema', `${corridor.countryCode} ${corridor.currency} ${corridor.transferMethod} — required fields validated`);

  const payload =
    profile.kind === 'us-local'
      ? usLocalBeneficiary({
          accountName: profile.accountName,
          accountNumber: profile.accountNumber!,
          routingNumber: profile.routingNumber!,
          bankName: profile.bankName,
          address: profile.address,
        })
      : profile.kind === 'gb-local'
        ? gbLocalBeneficiary({
            accountName: profile.accountName,
            accountNumber: profile.accountNumber!,
            sortCode: profile.sortCode!,
            bankName: profile.bankName,
            address: profile.address,
          })
        : euSwiftBeneficiary({
            accountName: profile.accountName,
            iban: profile.iban!,
            swiftCode: profile.swiftCode!,
            bankName: profile.bankName,
            address: profile.address,
          });
  const record = await createBeneficiary(client, payload);
  return record.id;
}

function printPlan(logger: Logger, plan: PlannerResult, confidence: number): void {
  logger.detail('Forecast confidence', confidence.toFixed(2));
  logger.detail('Settled budget', `USD ${plan.budget.settledUsd} above the reserve floor`);
  logger.detail('Forecast commitment limit', `USD ${plan.budget.commitmentLimitUsd}`);
  logger.detail('Total budget', `USD ${plan.budget.totalUsd}`);
  logger.detail('Projected reserve', `USD ${plan.projectedReserveUsd}`);
  if (plan.projectedReserveUsd < 9_000) {
    logger.info(
      'Note: the projected reserve sits below the floor until the forecast receipt arrives — that is why the commitment limit gates these actions.',
    );
  }
  for (const action of plan.actions) {
    const label = action.obligation.counterparty;
    switch (action.kind) {
      case 'FUND':
        logger.decision('FUND', `${label} ${formatAmount(action.obligation.amount, action.obligation.currency)} — ${action.reason}`);
        break;
      case 'CONVERT_AND_FUND':
        logger.decision(
          'CONVERT+FUND',
          `${label} — convert ${action.convertAmount} ${action.buyCurrency} (cost USD ${action.costUsd}) then pay ${formatAmount(action.obligation.amount, action.obligation.currency)}`,
        );
        break;
      case 'DEFER':
        logger.decision('DEFER', `${label} — ${action.reason}`);
        break;
      case 'ESCALATE':
        logger.decision('ESCALATE', `${label} — ${action.reason}`);
        break;
      case 'REQUIRE_APPROVAL':
        logger.decision('NEEDS APPROVAL', `${label} — ${action.reason}`);
        break;
    }
  }
}

function formatWallet(balances: Record<string, number>): string {
  return Object.entries(balances)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => formatAmount(amount, currency))
    .join(' | ');
}

function obligation(id: string): Obligation {
  const found = TREASURY_OBLIGATIONS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown obligation ${id}`);
  return found;
}
