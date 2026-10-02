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

export interface Analyst {
  readonly kind: 'claude' | 'heuristic';
  assessForecast(input: ForecastInput): Promise<ForecastAssessment>;
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

  async explainException(input: ExceptionInput): Promise<string> {
    return `${input.counterparty} is held for human review: ${input.reason}. No money moves until a person clears it — the pending amount is ${input.currency} ${input.amount}.`;
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
