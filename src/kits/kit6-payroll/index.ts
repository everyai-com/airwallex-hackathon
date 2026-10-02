import { getBalances, balanceOf } from '../../api/balances.js';
import { createBeneficiary, euSwiftBeneficiary } from '../../api/beneficiaries.js';
import { createFxConversion, createFxQuote, type FxQuote } from '../../api/fx.js';
import { collectCharge, PLATFORM_REASONS } from '../../api/platform.js';
import { advanceTransferToPaid, createTransfer } from '../../api/transfers.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2, roundTo } from '../../core/money.js';
import { TRANSFER_REASONS } from '../shared.js';
import { PLATFORM_ON_BEHALF_NOTE, fundCustomerWallet, openConnectedAccount } from '../platform-shared.js';
import {
  assessPayroll,
  crossTenantGuard,
  PAYROLL_POLICY,
  type ContractorPayroll,
  type PayrollAssessment,
} from './policy.js';

const CONTRACTORS: Record<string, ContractorPayroll[]> = {
  acme: [
    { name: 'Lena Fischer', amount: 3_400, currency: 'EUR' },
    { name: 'Tomás Rivera', amount: 2_600, currency: 'EUR' },
  ],
  borealis: [{ name: 'Ingrid Solberg', amount: 6_000, currency: 'EUR' }],
};

export async function runKit6(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = client.requestIds();
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Multi-Employer Payroll Executor — tenant-isolated payouts, priced with fees');
  logger.info(
    `Goal: run payroll per employer without ever using one employer's funds for another. ${PLATFORM_ON_BEHALF_NOTE}`,
  );

  const employers = [
    { key: 'acme', name: 'Acme Manufacturing GmbH', ein: '88-2204501', contact: 'Ana Weber' },
    { key: 'borealis', name: 'Borealis Labs AB', ein: '88-2204502', contact: 'Bo Lindqvist' },
    { key: 'cobalt', name: 'Cobalt Retail LLC', ein: '88-2204503', contact: 'Cleo Nakamura' },
  ];

  const accountIds = new Map<string, string>();
  await logger.step('Activate all three employers before any FX call', async () => {
    for (const employer of employers) {
      const accountId = await openConnectedAccount(client, {
        businessName: employer.name,
        ein: employer.ein,
        contactName: employer.contact,
        city: 'New York',
        countryCode: 'US',
      });
      accountIds.set(employer.key, accountId);
      logger.detail(employer.name, `${accountId} ACTIVE`);
    }
  });

  await logger.step('Fund two employers; the third is intentionally empty', async () => {
    await fundCustomerWallet(client, accountIds.get('acme')!, 20_000);
    await fundCustomerWallet(client, accountIds.get('borealis')!, 5_000);
    for (const employer of employers) {
      const balances = await getBalances(client, { onBehalfOf: accountIds.get(employer.key)! });
      logger.detail(
        employer.name,
        balances.map((line) => `${line.currency} ${line.available}`).join(' | ') || 'USD 0',
      );
    }
  });

  const acmeAccount = accountIds.get('acme')!;

  let acmeQuote: FxQuote | undefined;
  let acmeAssessment: PayrollAssessment | undefined;
  await logger.step("Price Acme's payroll with the rate Acme will actually trade at", async () => {
    const payrollTotal = round2(
      CONTRACTORS.acme!.reduce((total, item) => total + item.amount, 0) +
        CONTRACTORS.acme!.length * PAYROLL_POLICY.swiftFeeEur,
    );
    acmeQuote = await createFxQuote(client, {
      requestId: ids.fresh(),
      sellCurrency: 'USD',
      buyCurrency: 'EUR',
      buyAmount: payrollTotal,
      onBehalfOf: acmeAccount,
    });
    acmeAssessment = assessPayroll(
      CONTRACTORS.acme!,
      { USD: 1, EUR: roundTo(1 / acmeQuote.rate, 8) },
      { USD: 20_000 },
    );
    logger.detail(
      'Quote (execution rate)',
      `${acmeQuote.id} at ${acmeQuote.rate} — single use, booked by the conversion below`,
    );
    logger.detail(
      'Payroll',
      `EUR ${acmeAssessment.totalPayroll} + EUR ${acmeAssessment.swiftFees} SWIFT fees`,
    );
    logger.detail(
      'Convert to pay',
      `EUR ${acmeAssessment.totalRequired} (about USD ${acmeAssessment.requiredUsd})`,
    );
    logger.decision(
      'PRICE FEES FIRST',
      "Converting only the payroll total would make the last contractor's payout fail on insufficient funds.",
    );
  });

  await logger.step("Convert Acme's payroll on Acme's behalf, then pay both contractors", async () => {
    const conversion = await createFxConversion(client, {
      requestId: ids.forOperation('acme-conversion'),
      sellCurrency: 'USD',
      buyCurrency: 'EUR',
      buyAmount: acmeAssessment!.totalRequired,
      quoteId: acmeQuote!.id,
      onBehalfOf: acmeAccount,
    });
    logger.detail(
      'Conversion',
      `${conversion.conversionId} ${conversion.status} — EUR ${conversion.buyAmount} for USD ${conversion.sellAmount}`,
    );

    for (const contractor of CONTRACTORS.acme!) {
      const beneficiary = await createBeneficiary(
        client,
        euSwiftBeneficiary({
          accountName: contractor.name,
          iban: 'DE89370400440532013000',
          swiftCode: 'COBADEFFXXX',
          bankName: 'Commerzbank',
          address: {
            streetAddress: 'Kaiserplatz 1',
            city: 'Frankfurt',
            postcode: '60311',
            countryCode: 'DE',
          },
        }),
        { onBehalfOf: acmeAccount },
      );
      const transfer = await createTransfer(client, {
        requestId: ids.forOperation(`acme-pay-${contractor.name}`),
        transferCurrency: 'EUR',
        transferAmount: contractor.amount,
        transferMethod: 'SWIFT',
        reason: TRANSFER_REASONS.professionalServices,
        reference: `payroll ${contractor.name}`,
        beneficiaryId: beneficiary.id,
        onBehalfOf: acmeAccount,
      });
      const paid = await advanceTransferToPaid(client, transfer, { onBehalfOf: acmeAccount });
      logger.detail(`Paid ${contractor.name}`, `${paid.id} ${paid.status} EUR ${contractor.amount}`);
    }
    logger.info(
      'Every employer FX call, transfer and simulation carried x-on-behalf-of; without it the calls would target the platform wallet.',
    );
  });

  const borealisAccount = accountIds.get('borealis')!;
  logger.chapter("Borealis is short: its wallet cannot cover converted payroll plus fees");
  const borealisBalances = await getBalances(client, { onBehalfOf: borealisAccount });
  const borealisWallet = Object.fromEntries(
    borealisBalances.map((line) => [line.currency, line.available]),
  );
  const assessment = assessPayroll(
    CONTRACTORS.borealis!,
    { USD: 1, EUR: roundTo(1 / acmeQuote!.rate, 8) },
    borealisWallet,
  );
  logger.detail('Required', `USD ${assessment.requiredUsd} (payroll + SWIFT fee)`);
  logger.detail('Available', `USD ${assessment.availableUsd}`);
  logger.decision('SHORTFALL', `USD ${assessment.shortfallUsd} — do not run this payroll`);
  logger.decision('ISOLATION', crossTenantGuard('Borealis Labs AB', 'Cobalt Retail LLC'));

  await logger.step("Cobalt's deposit lands mid-run — Borealis stays short", async () => {
    await fundCustomerWallet(client, accountIds.get('cobalt')!, 10_000);
    const cobaltBalances = await getBalances(client, { onBehalfOf: accountIds.get('cobalt')! });
    logger.detail('Cobalt wallet', cobaltBalances.map((line) => `USD ${line.available}`).join(' | '));
    const recheck = await getBalances(client, { onBehalfOf: borealisAccount });
    logger.detail(
      'Borealis wallet',
      recheck.map((line) => `USD ${line.available}`).join(' | ') || 'USD 0',
    );
    logger.info(
      'The deposit changed a different wallet: Borealis payroll stays blocked until its own funds arrive. Summing balances across tenants would have reported enough money for a batch Borealis cannot fund.',
    );
  });

  await logger.step('Collect platform fees from the employers that ran', async () => {
    const acmeFee = await collectCharge(client, {
      requestId: ids.forOperation('acme-fee'),
      amount: PAYROLL_POLICY.platformFeePerRunUsd,
      currency: 'USD',
      source: acmeAccount,
      reason: PLATFORM_REASONS.fee,
      reference: 'payroll run fee',
    });
    const cobaltFee = await collectCharge(client, {
      requestId: ids.forOperation('cobalt-fee'),
      amount: PAYROLL_POLICY.platformFeePerRunUsd,
      currency: 'USD',
      source: accountIds.get('cobalt')!,
      reason: PLATFORM_REASONS.fee,
      reference: 'payroll run fee',
    });
    logger.detail('Acme fee', `${acmeFee.id} ${acmeFee.status} USD ${PAYROLL_POLICY.platformFeePerRunUsd}`);
    logger.detail('Cobalt fee', `${cobaltFee.id} ${cobaltFee.status} USD ${PAYROLL_POLICY.platformFeePerRunUsd}`);
  });

  logger.chapter('Outcome');
  const platform = balanceOf(await getBalances(client), 'USD');
  logger.detail('Platform wallet', `USD ${round2(platform)} (fees collected, no tenant money touched)`);
  logger.detail('Acme', `payroll paid: EUR ${formatAmount(6_000, 'EUR')} + EUR 25.70 SWIFT fees`);
  logger.detail('Borealis', 'payroll HELD — awaiting its own funds; escalated to the employer');
  logger.detail('Cobalt', 'deposit received; fee collected; no payroll due');
}
