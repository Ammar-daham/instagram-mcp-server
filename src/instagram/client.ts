/** Thin wrapper around the Instagram Graph API (Instagram Login flavour). */

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  fbtrace_id?: string;
}

export class InstagramApiError extends Error {
  override name = "InstagramApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly graph: GraphErrorBody | undefined,
  ) {
    super(message);
  }

  get code(): number | undefined {
    return this.graph?.code;
  }

  get isAuthError(): boolean {
    return this.graph?.code === 190;
  }
}

export type Params = Record<string, string | number | boolean | undefined>;

export interface ClientOptions {
  accessToken: string;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
  /** Extra attempts after the first one for transient failures. */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  /** Prefix the path with the API version (false for e.g. /refresh_access_token). */
  versioned?: boolean;
}

// Graph error codes that mean "try again later": unknown/service errors and rate limits.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const MAX_RETRY_AFTER_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class InstagramClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions) {
    this.accessToken = options.accessToken;
    this.baseUrl = (options.baseUrl ?? "https://graph.instagram.com").replace(/\/+$/, "");
    this.apiVersion = options.apiVersion ?? "v24.0";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get<T>(path: string, params: Params = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, params, options);
  }

  post<T>(path: string, params: Params = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, params, options);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Params,
    { versioned = true }: RequestOptions,
  ): Promise<T> {
    const url = new URL(
      `${this.baseUrl}${versioned ? `/${this.apiVersion}` : ""}/${path.replace(/^\/+/, "")}`,
    );
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, access_token: this.accessToken })) {
      if (value === undefined) continue;
      if (method === "GET") url.searchParams.set(key, String(value));
      else form.set(key, String(value));
    }
    const init: RequestInit =
      method === "GET"
        ? { method }
        : { method, body: form, headers: { Accept: "application/json" } };

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (cause) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        // Don't include the URL: it carries the access token.
        throw new InstagramApiError(
          `Could not reach Instagram (${method} /${path.replace(/^\/+/, "")}): ${(cause as Error).message}`,
          0,
          undefined,
        );
      }

      const body = await parseBody(response);
      if (response.ok && !isErrorBody(body)) return body as T;

      const graph = isErrorBody(body) ? body.error : undefined;
      const retryable =
        response.status >= 500 ||
        response.status === 429 ||
        graph?.is_transient === true ||
        (graph?.code !== undefined && RETRYABLE_CODES.has(graph.code));
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(response) ?? this.backoff(attempt));
        continue;
      }
      throw new InstagramApiError(describeError(response.status, graph), response.status, graph);
    }
  }

  private backoff(attempt: number): number {
    return this.retryDelayMs * 2 ** attempt;
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

function isErrorBody(body: unknown): body is { error: GraphErrorBody } {
  return (
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "object"
  );
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : undefined;
}

export function describeError(status: number, graph: GraphErrorBody | undefined): string {
  const detail = graph?.message ?? `HTTP ${status}`;
  const trace = graph?.fbtrace_id ? ` (fbtrace_id ${graph.fbtrace_id})` : "";
  const code = graph?.code;

  let summary: string;
  if (code === 190) {
    summary =
      "Instagram rejected the access token: it is invalid, expired or was revoked. " +
      "Generate a new long-lived token (see docs/META_SETUP.md).";
  } else if (code === 10 || (code !== undefined && code >= 200 && code < 300)) {
    summary =
      "The access token is missing a permission for this action. Regenerate it with the " +
      "instagram_business_* permissions listed in docs/META_SETUP.md.";
  } else if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    summary = "Instagram rate limit reached. Wait a while before trying again.";
  } else if (status >= 500) {
    summary = "Instagram is having problems right now (server error). Try again later.";
  } else {
    summary = `Instagram API error${code !== undefined ? ` ${code}` : ""}.`;
  }
  return `${summary} Details: ${detail}${trace}`;
}
