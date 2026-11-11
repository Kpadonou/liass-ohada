import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FiscalHttpResponse } from "../providers/http-transport";
export const CONFIRMATION_RESPONSE_LIMIT = 64 * 1024;
/** Private diagnostic artifact only. No URL, headers, credentials or business request. */
export class ConfirmationCapture {
  constructor(private readonly bucket: string, private readonly client = new S3Client({ maxAttempts: 1 })) {}
  async save(reference: string, response: FiscalHttpResponse) {
    if (!this.bucket || !/^[a-f0-9]{64}$/.test(reference) || Buffer.byteLength(response.body) > CONFIRMATION_RESPONSE_LIMIT)
      throw new Error("FISCAL_CAPTURE_INVALID");
    const body = JSON.stringify({ schemaVersion: 1, environment: "TEST", capturedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
          httpStatus: response.status, truncated: response.truncated === true, body: response.body });
    if (Buffer.byteLength(body) > 400 * 1024) throw new Error("FISCAL_CAPTURE_INVALID");
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: reference, Body: body,
        ContentType: "application/json", ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
    } catch { throw new Error("FISCAL_CAPTURE_FAILED"); }
  }
  /** Restricted recovery read. The caller still validates the complete envelope
   * and source binding; raw response bytes never leave the fiscal boundary. */
  async read(reference: string): Promise<unknown> {
    if (!this.bucket || !/^[a-f0-9]{64}$/.test(reference))
      throw new Error("FISCAL_CAPTURE_INVALID");
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: reference }),
      );
      if (!result.Body) throw new Error();
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        length += chunk.byteLength;
        if (length > 400 * 1024) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("FISCAL_CAPTURE_UNAVAILABLE");
    }
  }
}
