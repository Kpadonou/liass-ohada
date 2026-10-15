import { createHash } from "crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { AssignInitialProductRoleRequestSchema } from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { OrganizationMemberRepository } from "../repositories/organization-member-repository";
import { InitialProductRoleRepository as R } from "../repositories/initial-product-role-repository";
import { TenantAccessService } from "./tenant-access-service";
import { ProductAccessService } from "./product-access-service";

export class InitialProductRoleService {
  static async assign(orgId: string, actorUserId: string, input: unknown) {
    const request = AssignInitialProductRoleRequestSchema.parse(input);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          "ASSIGN_INITIAL_PRODUCT_ROLE",
          orgId,
          actorUserId,
          request.memberUserId,
          request.productCode,
          request.role,
        ]),
      )
      .digest("hex");
    // Revalidate after a raced transaction. No role replacement or unbounded retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const actor = await TenantAccessService.assertUserCanAccessOrg({
        orgId,
        userId: actorUserId,
      });
      if (
        actor.role !== "OWNER" ||
        actor.workspaceType !== "COMPANY" ||
        (actor.accessSource !== undefined && actor.accessSource !== "DIRECT")
      )
        throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
      await OrganizationMemberRepository.requireActiveCompany(orgId);
      const entitlement = await ProductAccessService.requireActiveProductAccess(
        {
          orgId,
          productCode: request.productCode,
          action: "ASSIGN_INITIAL_PRODUCT_ROLE",
        },
      );
      if (
        entitlement.orgId !== orgId ||
        entitlement.productCode !== request.productCode
      )
        throw new AppError(403, "PRODUCT_ACCESS_REQUIRED");
      const target = await R.target(orgId, request.memberUserId);
      const replay = await R.replay(
        orgId,
        actorUserId,
        request.clientRequestId,
        fingerprint,
      );
      if (replay) return replay;
      try {
        return await R.commit(orgId, actorUserId, request, target, fingerprint);
      } catch (error) {
        if (!(error instanceof TransactionCanceledException)) throw error;
        if (
          error.CancellationReasons?.some(
            (reason) =>
              reason.Code &&
              ![
                "None",
                "ConditionalCheckFailed",
                "TransactionConflict",
              ].includes(reason.Code),
          )
        )
          throw error;
      }
    }
    throw new AppError(409, "PLATFORM_PRODUCT_ROLE_WRITE_CONFLICT");
  }
}
