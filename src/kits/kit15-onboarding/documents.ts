/**
 * Kit 15 scenario — three supplier onboarding letters and one correction.
 * Semi-structured like real bank-detail letters: the onboarding policy extracts
 * and checksums every field in code, and the analyst only flags the shape.
 */

export interface SupplierDoc {
  id: string;
  reference: string;
  supplier: string;
  text: string;
}

export const SUPPLIER_DOCS: SupplierDoc[] = [
  {
    id: 'sup-us',
    reference: 'SUP-101',
    supplier: 'Meridian Freight LLC',
    text: [
      'SUPPLIER ONBOARDING SUP-101',
      'Supplier: Meridian Freight LLC',
      'Remit payment in USD to the account below. All freight invoices settle by local transfer.',
      '',
      'ACCOUNT NAME: Meridian Freight LLC',
      'ACCOUNT NUMBER: 778812349',
      'ABA ROUTING: 021000021',
      'BANK: JPMorgan Chase',
      'ADDR: 1201 Western Avenue | Seattle | WA | 98101 | US',
    ].join('\n'),
  },
  {
    id: 'sup-de',
    reference: 'SUP-102',
    supplier: 'Steinmetz GmbH',
    text: [
      'SUPPLIER ONBOARDING SUP-102',
      'Supplier: Steinmetz GmbH',
      'Remit payment in EUR to the account below. All tooling invoices settle by SWIFT transfer.',
      '',
      'ACCOUNT NAME: Steinmetz GmbH',
      'IBAN: DE89370400440532013000',
      'SWIFT: COBADEFFXXX',
      'BANK: Commerzbank',
      'ADDR: Kaiserstrasse 16 | Frankfurt | HE | 60311 | DE',
    ].join('\n'),
  },
  {
    id: 'sup-gb',
    reference: 'SUP-103',
    supplier: 'Lowly & Sons Ltd',
    text: [
      'SUPPLIER ONBOARDING SUP-103',
      'Supplier: Lowly & Sons Ltd',
      'Payments may also route via our US correspondent account while the UK',
      'details are finalized - please confirm the sort code before the first payment.',
      '',
      'ACCOUNT NAME: Lowly & Sons Ltd',
      'ACCOUNT NUMBER: 12345678',
      'SORT CODE: 40-12-3',
      'BANK: Barclays',
      'ADDR: 27 High Street | Leeds | West Yorkshire | LS1 4BR | GB',
    ].join('\n'),
  },
];

/** New information mid-run: Lowly corrects the sort code and the corridor. */
export const CORRECTED_DOC = {
  supplier: 'Lowly & Sons Ltd',
  reference: 'SUP-103R',
  text: [
    'CORRECTED BANK DETAILS SUP-103R',
    'Supplier: Lowly & Sons Ltd',
    'All GBP payments go to the UK account below. This letter supersedes the earlier one.',
    '',
    'ACCOUNT NAME: Lowly & Sons Ltd',
    'ACCOUNT NUMBER: 12345678',
    'SORT CODE: 23-14-70',
    'BANK: Barclays',
    'ADDR: 27 High Street | Leeds | West Yorkshire | LS1 4BR | GB',
  ].join('\n'),
};
