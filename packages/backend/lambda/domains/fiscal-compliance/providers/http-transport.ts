export interface FiscalHttpRequest {
  method: "GET";
  url: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface FiscalHttpResponse {
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
    redirect: "error",
    signal: request.signal,
  });

  return { status: response.status, body: await response.text() };
};
