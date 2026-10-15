import { z } from "zod";
import {
  ListOrganizationMembersRequestSchema,
  ListOrganizationMembersResponseSchema,
} from "@liass-ohada/shared/shared";
import { AppError } from "../app-error";
import { OrganizationMemberRepository } from "../repositories/organization-member-repository";
import { UserProfileRepository } from "../repositories/user-profile-repository";
import { TenantAccessService } from "./tenant-access-service";

export class OrganizationMemberService {
  static async list(orgId: string, actorUserId: string, input: unknown) {
    const request = ListOrganizationMembersRequestSchema.parse(input);
    // Platform authority is independent of all product roles and entitlements.
    const access = await TenantAccessService.assertUserCanAccessOrg({
      orgId,
      userId: actorUserId,
    });
    if (
      access.workspaceType !== "COMPANY" ||
      access.role !== "OWNER" ||
      (access.accessSource !== undefined && access.accessSource !== "DIRECT")
    )
      throw new AppError(403, "ERROR_ORG_ACCESS_DENIED");
    await OrganizationMemberRepository.requireActiveCompany(orgId);
    const page = await OrganizationMemberRepository.list(
      orgId,
      actorUserId,
      request,
    );
    const profiles = await UserProfileRepository.batchGet(
      page.items.map((row) => row.userId),
      true,
    );
    return ListOrganizationMembersResponseSchema.parse({
      items: page.items.map((row) => {
        const profile = profiles.get(row.userId);
        const name = profile?.displayName.trim();
        // Profile synchronization may use email as fallback; do not present it as a person's name.
        const displayName =
          name &&
          name.length <= 160 &&
          !name.includes("@") &&
          name !== row.userId &&
          !z.uuid().safeParse(name).success &&
          !/[\u0000-\u001f\u007f]/.test(name)
            ? name
            : undefined;
        return {
          userId: row.userId,
          status: row.status,
          displayName,
          email:
            profile?.emailVerified && z.email().safeParse(profile.email).success
              ? profile.email
              : undefined,
        };
      }),
      nextCursor: page.nextCursor,
    });
  }
}
