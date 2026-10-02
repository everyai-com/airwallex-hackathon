import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  clientId?: string;
  apiKey?: string;
  baseUrl: string;
  filesUrl: string;
  mock: boolean;
  dataDir: string;
  /** Optional: when present, the analyst layer reads unstructured text with Claude. */
  anthropicApiKey?: string;
  anthropicModel: string;
}

function parseDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fromFile = parseDotEnv(resolve(PROJECT_ROOT, '.env'));
  const get = (key: string): string | undefined => env[key] ?? fromFile[key] ?? undefined;
  const mock = ['1', 'true', 'yes'].includes((get('MOCK') ?? '').toLowerCase());

  return {
    clientId: get('AWX_CLIENT_ID') || undefined,
    apiKey: get('AWX_API_KEY') || undefined,
    baseUrl: get('AWX_BASE_URL') ?? 'https://api.sandbox.airwallex.com',
    filesUrl: get('AWX_FILES_URL') ?? 'https://files.sandbox.airwallex.com',
    mock,
    dataDir: resolve(PROJECT_ROOT, get('AWX_DATA_DIR') ?? '.data'),
    anthropicApiKey: get('ANTHROPIC_API_KEY') || undefined,
    anthropicModel: get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5',
  };
}

export function requireCredentials(config: Config): { clientId: string; apiKey: string } {
  if (!config.clientId || !config.apiKey) {
    throw new Error(
      'Missing AWX_CLIENT_ID / AWX_API_KEY. Copy .env.example to .env and fill in your sandbox keys, or run with MOCK=1 to use the simulator.',
    );
  }
  return { clientId: config.clientId, apiKey: config.apiKey };
}
