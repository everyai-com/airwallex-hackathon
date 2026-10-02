import { errorFromResponse, TransportError } from './errors.js';
import { buildQueryString, type ApiRequest, type ApiResponse, type Transport } from './transport.js';

export function liveTransport(): Transport {
  return {
    kind: 'live',
    async send<T>(request: ApiRequest): Promise<ApiResponse<T>> {
      const url = `${request.baseUrl ?? ''}${request.path}${buildQueryString(request.query)}`;
      const headers: Record<string, string> = { ...request.headers };
      const init: RequestInit = { method: request.method, headers };

      if (request.formData) {
        init.body = request.formData;
      } else if (request.body !== undefined) {
        init.body = JSON.stringify(request.body);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        throw new TransportError(
          `Network error calling ${request.method} ${url}: ${(cause as Error).message}`,
          cause,
        );
      }

      const text = await response.text();
      let data: unknown;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!response.ok) {
        throw errorFromResponse(response.status, data);
      }
      return { status: response.status, data: data as T };
    },
  };
}
