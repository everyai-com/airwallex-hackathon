export type HttpMethod = 'GET' | 'POST';

export interface ApiRequest {
  method: HttpMethod;
  /** Path beginning with /api/v1, e.g. /api/v1/transfers/create */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  /** Override the API host, e.g. the files service. */
  baseUrl?: string;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

export interface Transport {
  readonly kind: 'live' | 'mock';
  send<T>(request: ApiRequest): Promise<ApiResponse<T>>;
}

export function buildQueryString(
  query: ApiRequest['query'],
): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}
