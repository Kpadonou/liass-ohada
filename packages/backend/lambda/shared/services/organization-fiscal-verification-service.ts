import {
  VerifyFiscalConnectionRequestSchema,
  FiscalVerificationResult,
} from "@liass-ohada/shared/shared";
import { FiscalComplianceConnectionVerifier } from "../../domains/fiscal-compliance/connection-verification";
import {
  OrganizationFiscalRepository as Connections,
  fiscalConfigurationDigest,
} from "../repositories/organization-fiscal-repository";
import { FiscalVerificationRepository as Attempts } from "../repositories/fiscal-verification-repository";
import { OrganizationLegalIdentityService } from "./organization-legal-identity-service";
import { PlatformSfeRepository } from "../repositories/platform-sfe-repository";
import {
  FiscalVerificationBindingSchema,
  evaluateDgiStatus,
  publicVerification,
  verificationOutcome,
} from "./fiscal-verification-model";
import type { PlatformPrincipal } from "../authorization/platform-admin";
import { AppError } from "../app-error";

/** Independent read-only gate. Neither customer configuration nor the fiscal executor gate can enable it. */
export const credentialTestVerificationEnabled = (
  stage: PlatformPrincipal["stage"],
  environment: "TEST" | "PRODUCTION",
) =>
  environment === "TEST" &&
  stage !== "prod" &&
  process.env.FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED === "1";
export class OrganizationFiscalVerificationService {
  constructor(
    private readonly provider = new FiscalComplianceConnectionVerifier(),
    private readonly clock = () => new Date().toISOString(),
  ) {}
  async verify(
    orgId: string,
    principal: PlatformPrincipal,
    input: unknown,
  ): Promise<FiscalVerificationResult> {
    const request = VerifyFiscalConnectionRequestSchema.parse(input);
    await Connections.authorize(orgId, principal.sub, true);
    const source = await Connections.readForVerification(
      orgId,
      request.environment,
      request.connectionId,
    );
    if (!source)
      throw new AppError(404, "PLATFORM_FISCAL_CONNECTION_NOT_FOUND");
    const identity =
      await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(
        orgId,
      ).catch(() => null);
    const digest = fiscalConfigurationDigest(source);
    const previous = await Attempts.read(orgId, principal, request);
    if (previous) {
      const view = publicVerification(
        { binding: previous.binding, result: previous.result },
        { digest, identity: identity?.binding ?? null },
        this.clock(),
      );
      if (
        view.inProgress &&
        Date.parse(previous.leaseUntil) <= Date.parse(this.clock())
      )
        view.inProgress = false;
      return view; // Never dispatch again for a reserved command, including after a timeout/crash.
    }
    if (source.data.version !== request.expectedVersion)
      throw new AppError(409, "PLATFORM_FISCAL_CONFLICT");
    const enabled = credentialTestVerificationEnabled(
      principal.stage,
      request.environment,
    );
    let credential:
      | Awaited<ReturnType<typeof Connections.credentialBinding>>
      | undefined;
    let invalidCredentialBinding = false;
    let credentialBindingUnavailable = false;
    if (enabled && source.secretReference) {
      try {
        credential = await Connections.credentialBinding(
          orgId,
          principal,
          source,
        );
      } catch (error) {
        if (
          (error instanceof AppError && error.statusCode === 422) ||
          (error as { name?: string }).name === "ZodError"
        )
          invalidCredentialBinding = true;
        else credentialBindingUnavailable = true;
      }
    }
    const binding = FiscalVerificationBindingSchema.parse({
      orgId,
      connectionId: request.connectionId,
      environment: request.environment,
      configurationVersion: source.data.version,
      configurationDigest: digest,
      identity: identity?.binding ?? null,
      credentialReference: source.secretReference ?? null,
      credentialVersion: source.secretReference ? 1 : null,
      credentialStorageVersion: credential?.storageVersion ?? null,
    });
    const reservation = await Attempts.reserve(
      orgId,
      principal,
      request,
      source,
      binding,
      this.clock(),
      identity?.check,
    );
    if (!reservation.owned) {
      const currentSource = await Connections.readForVerification(
        orgId,
        request.environment,
        request.connectionId,
      );
      const currentIdentity =
        await OrganizationLegalIdentityService.readFiscalTaxpayerAuthority(
          orgId,
        ).catch(() => null);
      const view = publicVerification(
        {
          binding: reservation.operation.binding,
          result: reservation.operation.result,
        },
        {
          digest: currentSource ? fiscalConfigurationDigest(currentSource) : "",
          identity: currentIdentity?.binding ?? null,
        },
        this.clock(),
      );
      if (
        view.inProgress &&
        Date.parse(reservation.operation.leaseUntil) <= Date.parse(this.clock())
      )
        view.inProgress = false;
      return view;
    }
    let result = reservation.operation.result;
    const done = (status: FiscalVerificationResult["status"]) =>
      verificationOutcome(result, status, this.clock());
    if (!enabled) result = done("VERIFICATION_NOT_ENABLED");
    else if (invalidCredentialBinding)
      result = {
        ...done("CREDENTIAL_CONFIGURATION_INVALID"),
        checks: { ...result.checks, credentialStored: false },
      };
    else if (credentialBindingUnavailable)
      result = done("VERIFICATION_INCOMPLETE");
    else if (!credential || !identity?.ifu || !source.data.taxpayerIfu)
      result = done("VERIFICATION_INCOMPLETE");
    else if (source.data.taxpayerIfu !== identity.ifu)
      result = {
        ...done("IFU_MISMATCH"),
        checks: { ...result.checks, ifuConsistency: "MISMATCH" },
      };
    else {
      let token: string | undefined;
      try {
        token = await Connections.readVerificationCredential(
          source,
          credential,
        );
      } catch (error) {
        result = done(
          error instanceof AppError &&
            error.messageCode === "PLATFORM_FISCAL_CREDENTIAL_INVALID"
            ? "CREDENTIAL_CONFIGURATION_INVALID"
            : "VERIFICATION_INCOMPLETE",
        );
      }
      if (token)
        try {
          const status = await this.provider.readStatus({
            environment: request.environment,
            credential: { environment: source.data.environment, value: token },
          });
          result = evaluateDgiStatus(
            result,
            status,
            identity.ifu,
            source.data.taxpayerIfu,
            source.data.nim,
            this.clock(),
          );
        } catch (error) {
          const code = (error as { code?: string }).code;
          result = done(
            code === "AUTHENTICATION_FAILED" || code === "ACCESS_FORBIDDEN"
              ? "AUTHENTICATION_REJECTED"
              : code === "MALFORMED_RESPONSE" || code === "PROVIDER_REJECTED"
                ? "PROVIDER_RESPONSE_INVALID"
                : "PROVIDER_UNAVAILABLE",
          );
        } finally {
          token = undefined;
        }
    }
    const sfe = await PlatformSfeRepository.read(principal.stage).catch(
      () => null,
    );
    result.checks.sfeApprovalReferences =
      sfe?.status === "REGISTERED" ? "AVAILABLE" : "UNVERIFIED";
    const outcome = await Attempts.finish(
      orgId,
      principal,
      request,
      source,
      reservation.operation,
      result,
      identity?.check,
    );
    await Connections.authorize(orgId, principal.sub, true);
    return outcome;
  }
}
