export interface FiscalHttpRequest {
  method: "GET" | "POST" | "PUT";
  body?: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface FiscalHttpResponse {
  truncated?: boolean;
  status: number;
  body: string;
}

export type FiscalHttpTransport = (
  request: FiscalHttpRequest,
) => Promise<FiscalHttpResponse>;

export const nodeFetchFiscalHttpTransport: FiscalHttpTransport = async (
  request,
) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal: request.signal,
  });

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  if (reader) {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = 64 * 1024 - length;
      chunks.push(next.value.subarray(0, remaining));
      length += Math.min(remaining, next.value.length);
      if (next.value.length > remaining) { truncated = true; await reader.cancel(); break; }
    }
  }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8"), ...(truncated ? { truncated } : {}) };
};
