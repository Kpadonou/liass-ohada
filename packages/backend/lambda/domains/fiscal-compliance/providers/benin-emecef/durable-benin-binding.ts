import { createHash } from "node:crypto";
import { canonical, clean } from "@/lambda/shared/authority/integrity";
import { FiscalAttemptState } from "../../core/fiscal-attempt-state";
import {
  MockFiscalProvider,
  VerifiedFiscalPreparation,
} from "../../core/synthetic-fiscal-orchestrator";
import {
  BeninEMecefTestAdapter,
  BeninInvoiceAttempt,
} from "./benin-emecef-test-adapter";
import { InvoiceRequestDataDtoSchema } from "./invoice-dtos";
import { z } from "zod";

/** TEST binding only. Credentials are freshly supplied per invocation, never stored.
 * Payload must be explicitly mapped by the trusted preparation boundary; no tax/unit inference.
 */
export class DurableBeninBinding implements MockFiscalProvider {
  readonly kind = "BENIN_EMECEF_TEST" as const;
  constructor(
    private readonly adapter: BeninEMecefTestAdapter,
    private readonly credential: () => string,
  ) {}
  private input() {
    if (process.env.NODE_ENV !== "test")
      throw new Error("FISCAL_BINDING_NOT_ENABLED");
    const credential = this.credential();
    if (!credential.trim()) throw new Error("FISCAL_CREDENTIAL_REQUIRED");
    return { environment: "TEST" as const, credential };
  }
  async createInvoice(prepared: VerifiedFiscalPreparation) {
    const payload = z
      .object({
        invoice: InvoiceRequestDataDtoSchema,
        expected: z
          .object({
            itemTotals: z.array(z.number().int().safe()),
            total: z.number().int().safe(),
          })
          .strict(),
      })
      .strict()
      .parse(prepared.payload);
    const digest = createHash("sha256")
      .update(canonical(clean(payload)))
      .digest("hex");
    if (
      digest !== prepared.requestDigest ||
      payload.expected.total !== prepared.total
    )
      throw new Error("FISCAL_MAPPING_MISMATCH");
    return this.adapter.createInvoice(
      this.input(),
      new BeninInvoiceAttempt(),
      payload.invoice,
      payload.expected,
    );
  }
  async confirmInvoice(uid: string, state?: FiscalAttemptState) {
    if (!state || state.uid !== uid || state.provider !== this.kind)
      throw new Error("FISCAL_RESERVATION_REQUIRED");
    const { uid: _uid, ...security } = await this.adapter.confirmDurableInvoice(
      this.input(),
      state,
    );
    return security;
  }
  async getInvoice(uid: string) {
    return this.adapter.getInvoice(this.input(), uid);
  }
}
