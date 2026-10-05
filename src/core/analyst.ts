/**
 * The analyst layer: the half of the brief that reads unstructured text and
 * compares evidence. It may only produce judgment (confidence, rationale,
 * citations) — never amounts, limits or reserves. Every number stays in code.
 *
 * Two implementations:
 * - ClaudeAnalyst    uses ANTHROPIC_API_KEY when present; any failure falls back
 * - HeuristicAnalyst deterministic, used in tests and when no key is configured
 */
import { roundTo } from './money.js';

export interface ForecastInput {
  forecast: {
    payer: string;
    amount: number;
    currency: string;
    expectedInHours: number;
    confidence: number;
    evidence: string[];
  };
  /** The raw, unstructured new information — an email body or a support note. */
  newInformation: string;
  source?: string;
}

export type ForecastDirection = 'reaffirmed' | 'weakened' | 'contradicted';

export interface ForecastAssessment {
  direction: ForecastDirection;
  /** 0..1 — the only number the analyst may move; policy code maps it to limits. */
  confidence: number;
  rationale: string;
  citedEvidence: string[];
}

export interface ExceptionInput {
  counterparty: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface RemittanceInput {
  customer: string;
  amount: number;
  currency: string;
  reference?: string;
  /** The raw remittance advice — an email body, a bank narrative, a PDF caption. */
  email: string;
}

/**
 * What the model may read from an unstructured remittance advice: which
 * invoices it references and whether it claims a discount or a credit.
 * It never decides the match or the money; the reconciliation policy does.
 */
export interface RemittanceReading {
  invoiceRefs: string[];
  mentionsDiscount: boolean;
  mentionsCredit: boolean;
  rationale: string;
  citedEvidence: string[];
}

export interface ContractInput {
  customer: string;
  /** PO number, MSA reference or amendment id — what the contract calls itself. */
  reference: string;
  /** The raw contract or PO text the customer sent. */
  text: string;
}

/**
 * What the model may read from a contract: which billing shapes it signals
 * (net terms, milestones, a dispute) — never lines, amounts or dates. The
 * billing policy parses every number in code.
 */
export interface ContractReading {
  mentionsNetTerms: boolean;
  mentionsMilestones: boolean;
  mentionsDispute: boolean;
  rationale: string;
  citedEvidence: string[];
}

export interface SupplierDocInput {
  supplier: string;
  /** Supplier reference — what the onboarding letter calls itself. */
  reference: string;
  /** The raw supplier onboarding letter or bank-details email. */
  text: string;
}

/**
 * What the model may read from a supplier doc: whether bank details are
 * present, whether several countries/corridors are signalled, and whether the
 * writer flags anything missing or uncertain. Field extraction, checksums and
 * the corridor decision are code.
 */
export interface SupplierDocReading {
  mentionsBankDetails: boolean;
  mentionsMultipleCountries: boolean;
  mentionsMissingDetails: boolean;
  rationale: string;
  citedEvidence: string[];
}

export interface Analyst {
  readonly kind: 'claude' | 'heuristic';
  assessForecast(input: ForecastInput): Promise<ForecastAssessment>;
  readRemittance(input: RemittanceInput): Promise<RemittanceReading>;
  readContract(input: ContractInput): Promise<ContractReading>;
  readSupplierDoc(input: SupplierDocInput): Promise<SupplierDocReading>;
  explainException(input: ExceptionInput): Promise<string>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const NEGATIVE_SIGNALS = [
  'slip',
  'delay',
  'postpone',
  'late',
  'hold',
  'committee',
  'unable',
  'cannot',
  "can't",
  'may not',
  'miss',
  'push back',
];

const POSITIVE_SIGNALS = [
  'paid',
  'sent',
  'confirmed',
  'processed',
  'scheduled',
  'released',
  'on the way',
  'same day',
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function matchingEvidence(text: string, signals: string[]): string[] {
  return sentences(text)
    .filter((sentence) => signals.some((signal) => sentence.toLowerCase().includes(signal)))
    .map((sentence) => (sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence))
    .slice(0, 4);
}

export class HeuristicAnalyst implements Analyst {
  readonly kind = 'heuristic' as const;

  async assessForecast(input: ForecastInput): Promise<ForecastAssessment> {
    const text = input.newInformation;
    const negatives = matchingEvidence(text, NEGATIVE_SIGNALS);
    const positives = matchingEvidence(text, POSITIVE_SIGNALS);

    if (negatives.length > 0 && positives.length === 0) {
      return {
        direction: 'contradicted',
        confidence: clamp(roundTo(input.forecast.confidence - 0.44, 2), 0.05, 0.99),
        rationale: `The new information undermines the receipt forecast: it contains ${negatives.length} negative timing signal(s) and no confirmation. Treat the ${input.forecast.currency} ${input.forecast.amount} expected in ${input.forecast.expectedInHours}h as unreliable.`,
        citedEvidence: negatives,
      };
    }

    if (positives.length > 0 && negatives.length === 0) {
      return {
        direction: 'reaffirmed',
        confidence: clamp(roundTo(input.forecast.confidence + 0.05, 2), 0.05, 0.99),
        rationale: `The new information confirms the receipt forecast: ${positives.length} positive signal(s) and no contradictions.`,
        citedEvidence: positives,
      };
    }

    return {
      direction: 'weakened',
      confidence: clamp(roundTo(input.forecast.confidence - 0.1, 2), 0.05, 0.99),
      rationale:
        'The new information is mixed or neutral, so the forecast keeps its direction with a lower confidence.',
      citedEvidence: [...negatives, ...positives].slice(0, 4),
    };
  }

  async readContract(input: ContractInput): Promise<ContractReading> {
    const mentionsNetTerms = /net[-\s]?\d{1,3}|payment terms|due within/i.test(input.text);
    const mentionsMilestones =
      /milestone|tranche|on signing|on delivery|upon (signing|delivery|acceptance)|\bphase\b|\bstage\b/i.test(
        input.text,
      );
    const mentionsDispute =
      /dispute|short[-\s]?(shipped|delivered|paid)|damaged|defective|withhold|deduct|claim/i.test(
        input.text,
      );
    const citedEvidence = sentences(input.text)
      .filter(
        (sentence) =>
          /net[-\s]?\d{1,3}|payment terms|due within|milestone|tranche|on signing|on delivery|upon (signing|delivery|acceptance)|\bphase\b|\bstage\b|dispute|short[-\s]?(shipped|delivered|paid)|damaged|defective|withhold|deduct|claim/i.test(
            sentence,
          ),
      )
      .slice(0, 4)
      .map((sentence) => (sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence));
    const shapes = [
      mentionsNetTerms ? 'net payment terms' : '',
      mentionsMilestones ? 'milestone billing' : '',
      mentionsDispute ? 'a disputed line' : '',
    ].filter(Boolean);
    return {
      mentionsNetTerms,
      mentionsMilestones,
      mentionsDispute,
      rationale: shapes.length
        ? `The contract signals ${shapes.join(', ')}. The code parses every line, amount and date.`
        : 'The contract carries no recognizable billing shape; the code decides from the parsed lines alone.',
      citedEvidence,
    };
  }

  async readSupplierDoc(input: SupplierDocInput): Promise<SupplierDocReading> {
    const mentionsBankDetails =
      /bank|account (number|name)|iban|routing|sort code|swift/i.test(input.text);
    const countryCues = [
      /\bUS\b|United States|ABA/i,
      /\bGB\b|\bUK\b|United Kingdom|sort code/i,
      /\bDE\b|Germany|IBAN/i,
    ].filter((pattern) => pattern.test(input.text)).length;
    const mentionsMultipleCountries = countryCues >= 2;
    const mentionsMissingDetails =
      /missing|incomplete|\bTBD\b|to follow|pending|unclear|confirm/i.test(input.text);
    const citedEvidence = sentences(input.text)
      .filter((sentence) =>
        /bank|account (number|name)|iban|routing|sort code|swift|\bUS\b|\bGB\b|\bUK\b|\bDE\b|missing|incomplete|\bTBD\b|to follow|pending|unclear|confirm/i.test(
          sentence,
        ),
      )
      .slice(0, 4)
      .map((sentence) => (sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence));
    const flags = [
      mentionsBankDetails ? 'bank details' : '',
      mentionsMultipleCountries ? 'multiple countries' : '',
      mentionsMissingDetails ? 'missing details' : '',
    ].filter(Boolean);
    return {
      mentionsBankDetails,
      mentionsMultipleCountries,
      mentionsMissingDetails,
      rationale: flags.length
        ? `The letter signals ${flags.join(', ')}. The code extracts and checksums every field.`
        : 'The letter carries no recognizable bank details; the code has nothing to validate.',
      citedEvidence,
    };
  }

  async explainException(input: ExceptionInput): Promise<string> {
    const reason = input.reason.trim().replace(/\.+$/, '');
    return `${input.counterparty} is held for human review: ${reason}. No money moves until a person clears it — the pending amount is ${input.currency} ${input.amount}.`;
  }

  async readRemittance(input: RemittanceInput): Promise<RemittanceReading> {
    const refs = [
      ...new Set((input.email.match(/\b[A-Z]{2,4}-\d{3,}\b/gi) ?? []).map((ref) => ref.toUpperCase())),
    ];
    const mentionsDiscount = /discount/i.test(input.email);
    const mentionsCredit = /credit note|credit for|credit of|deduct|short-?paid/i.test(input.email);
    const citedEvidence = sentences(input.email)
      .filter(
        (sentence) =>
          /\b[A-Z]{2,4}-\d{3,}\b/i.test(sentence) ||
          /discount|credit note|deduct|short-?paid/i.test(sentence),
      )
      .slice(0, 4)
      .map((sentence) => (sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence));

    return {
      invoiceRefs: refs,
      mentionsDiscount,
      mentionsCredit,
      rationale: refs.length
        ? `The remittance advice references ${refs.join(', ')}${mentionsCredit ? ' and claims a credit/deduction' : ''}${mentionsDiscount ? ' and mentions a discount' : ''}. The code decides the match.`
        : 'The remittance advice carries no invoice reference; the code must match by payer and amount.',
      citedEvidence,
    };
  }
}

const CLAUDE_SYSTEM_PROMPT = `You judge evidence quality for a treasury agent. You are given a receipt forecast and new unstructured information.
Return ONLY JSON: {"direction":"reaffirmed"|"weakened"|"contradicted","confidence":0..1,"rationale":"2-3 sentences","cited_evidence":["verbatim quote", ...]}.
You may lower or raise confidence, but you must not invent amounts, limits or obligations. Cite only text present in the input.`;

export interface ClaudeAnalystOptions {
  apiKey: string;
  model?: string;
  fallback?: Analyst;
}

export class ClaudeAnalyst implements Analyst {
  readonly kind = 'claude' as const;
  private readonly fallback: Analyst;
  private readonly model: string;

  constructor(private readonly options: ClaudeAnalystOptions) {
    this.fallback = options.fallback ?? new HeuristicAnalyst();
    this.model = options.model ?? 'claude-sonnet-4-5';
  }

  async assessForecast(input: ForecastInput): Promise<ForecastAssessment> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 500,
          system: CLAUDE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                forecast: input.forecast,
                new_information: input.newInformation,
                source: input.source ?? 'customer email',
              }),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text ?? '';
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        direction?: string;
        confidence?: number;
        rationale?: string;
        cited_evidence?: unknown;
      };
      const direction: ForecastDirection =
        json.direction === 'reaffirmed' || json.direction === 'contradicted'
          ? json.direction
          : 'weakened';
      const parsedConfidence = Number(json.confidence);
      return {
        direction,
        confidence: clamp(
          Number.isFinite(parsedConfidence) ? parsedConfidence : input.forecast.confidence,
          0.05,
          0.99,
        ),
        rationale: String(json.rationale ?? '').slice(0, 600),
        citedEvidence: Array.isArray(json.cited_evidence)
          ? json.cited_evidence.map((item) => String(item)).slice(0, 5)
          : [],
      };
    } catch (error) {
      const fallback = await this.fallback.assessForecast(input);
      return {
        ...fallback,
        rationale: `${fallback.rationale} (Claude analyst unavailable: ${(error as Error).message}; heuristic fallback used.)`,
      };
    }
  }

  async readRemittance(input: RemittanceInput): Promise<RemittanceReading> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: `You read a customer remittance advice for a receivables agent.
Return ONLY JSON: {"invoice_refs":["INV-1234", ...],"mentions_discount":true|false,"mentions_credit":true|false,"rationale":"1-2 sentences","cited_evidence":["verbatim quote", ...]}.
Extract only invoice references and whether the text claims a discount or a credit/deduction. Never invent invoice numbers or amounts.`,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text ?? '';
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        invoice_refs?: unknown;
        mentions_discount?: unknown;
        mentions_credit?: unknown;
        rationale?: unknown;
        cited_evidence?: unknown;
      };
      return {
        invoiceRefs: Array.isArray(json.invoice_refs)
          ? [...new Set(json.invoice_refs.map((ref) => String(ref).toUpperCase()))].slice(0, 8)
          : [],
        mentionsDiscount: json.mentions_discount === true,
        mentionsCredit: json.mentions_credit === true,
        rationale: String(json.rationale ?? '').slice(0, 600),
        citedEvidence: Array.isArray(json.cited_evidence)
          ? json.cited_evidence.map((item) => String(item)).slice(0, 5)
          : [],
      };
    } catch (error) {
      const fallback = await this.fallback.readRemittance(input);
      return {
        ...fallback,
        rationale: `${fallback.rationale} (Claude analyst unavailable: ${(error as Error).message}; heuristic fallback used.)`,
      };
    }
  }

  async readContract(input: ContractInput): Promise<ContractReading> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: `You read a customer purchase order or contract for a billing agent.
Return ONLY JSON: {"mentions_net_terms":true|false,"mentions_milestones":true|false,"mentions_dispute":true|false,"rationale":"1-2 sentences","cited_evidence":["verbatim quote", ...]}.
Flag only which billing shapes the text signals: net payment terms, milestone/tranche billing, or a disputed line. Never extract or invent amounts, dates, quantities or line items.`,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text ?? '';
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        mentions_net_terms?: unknown;
        mentions_milestones?: unknown;
        mentions_dispute?: unknown;
        rationale?: unknown;
        cited_evidence?: unknown;
      };
      return {
        mentionsNetTerms: json.mentions_net_terms === true,
        mentionsMilestones: json.mentions_milestones === true,
        mentionsDispute: json.mentions_dispute === true,
        rationale: String(json.rationale ?? '').slice(0, 600),
        citedEvidence: Array.isArray(json.cited_evidence)
          ? json.cited_evidence.map((item) => String(item)).slice(0, 5)
          : [],
      };
    } catch (error) {
      const fallback = await this.fallback.readContract(input);
      return {
        ...fallback,
        rationale: `${fallback.rationale} (Claude analyst unavailable: ${(error as Error).message}; heuristic fallback used.)`,
      };
    }
  }

  async readSupplierDoc(input: SupplierDocInput): Promise<SupplierDocReading> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: `You read a supplier onboarding letter for a payouts agent.
Return ONLY JSON: {"mentions_bank_details":true|false,"mentions_multiple_countries":true|false,"mentions_missing_details":true|false,"rationale":"1-2 sentences","cited_evidence":["verbatim quote", ...]}.
Flag only whether bank details are present, whether several countries or corridors are signalled, and whether the writer flags anything missing or uncertain. Never extract or invent account numbers, routings, IBANs or addresses.`,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text ?? '';
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        mentions_bank_details?: unknown;
        mentions_multiple_countries?: unknown;
        mentions_missing_details?: unknown;
        rationale?: unknown;
        cited_evidence?: unknown;
      };
      return {
        mentionsBankDetails: json.mentions_bank_details === true,
        mentionsMultipleCountries: json.mentions_multiple_countries === true,
        mentionsMissingDetails: json.mentions_missing_details === true,
        rationale: String(json.rationale ?? '').slice(0, 600),
        citedEvidence: Array.isArray(json.cited_evidence)
          ? json.cited_evidence.map((item) => String(item)).slice(0, 5)
          : [],
      };
    } catch (error) {
      const fallback = await this.fallback.readSupplierDoc(input);
      return {
        ...fallback,
        rationale: `${fallback.rationale} (Claude analyst unavailable: ${(error as Error).message}; heuristic fallback used.)`,
      };
    }
  }

  async explainException(input: ExceptionInput): Promise<string> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 200,
          system:
            'You explain, in two sentences or fewer, why a payment is escalated to a person. Do not invent facts.',
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
      const payload = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = payload.content?.find((block) => block.type === 'text')?.text?.trim();
      if (!text) throw new Error('empty completion');
      return text;
    } catch {
      return this.fallback.explainException(input);
    }
  }
}

export interface CreateAnalystOptions {
  apiKey?: string;
  model?: string;
  /** Force the deterministic analyst even when a key is present. */
  forceHeuristic?: boolean;
}

export function createAnalyst(options: CreateAnalystOptions = {}): Analyst {
  if (options.forceHeuristic || !options.apiKey) return new HeuristicAnalyst();
  return new ClaudeAnalyst({
    apiKey: options.apiKey,
    ...(options.model ? { model: options.model } : {}),
  });
}
