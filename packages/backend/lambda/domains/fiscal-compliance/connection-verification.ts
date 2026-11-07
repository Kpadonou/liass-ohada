import { BeninEMecefTestAdapter } from "./providers/benin-emecef/benin-emecef-test-adapter";
import type { FiscalHttpTransport } from "./providers/http-transport";

/** Public owning-domain boundary. No Platform persistence or credential lookup belongs here. */
export class FiscalComplianceConnectionVerifier {
  constructor(private readonly adapter = new BeninEMecefTestAdapter()) {}
  static withTransport(transport: FiscalHttpTransport) {
    return new FiscalComplianceConnectionVerifier(
      new BeninEMecefTestAdapter({ transport }),
    );
  }
  readStatus(input: {
    environment: "TEST" | "PRODUCTION";
    credential: { environment: "TEST" | "PRODUCTION"; value: string };
  }) {
    if (
      input.environment !== "TEST" ||
      input.credential.environment !== input.environment
    )
      throw new Error("ENVIRONMENT_NOT_ALLOWED");
    return this.adapter.getVerificationStatus({
      environment: input.environment,
      credential: input.credential.value,
    });
  }
}
export type FiscalConnectionStatusEvidence = Awaited<
  ReturnType<FiscalComplianceConnectionVerifier["readStatus"]>
>;
