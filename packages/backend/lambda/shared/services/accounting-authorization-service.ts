import type { AccountingPermission } from "../authorization/accounting-permission";
import { DomainAuthorizationService } from "./domain-authorization-service";
import {
  EffectiveOrganizationAccessService,
  type EffectiveOrganizationAccessContext,
  type ResolveEffectiveOrganizationAccessInput,
} from "./effective-organization-access-service";

export type AuthorizedAccountingContext = EffectiveOrganizationAccessContext;

export class AccountingAuthorizationService {
  static resolveAccess(
    input: ResolveEffectiveOrganizationAccessInput,
  ): Promise<AuthorizedAccountingContext> {
    return EffectiveOrganizationAccessService.resolveAccess(input);
  }

  static assertPermission(
    context: AuthorizedAccountingContext,
    permission: AccountingPermission,
  ): AuthorizedAccountingContext {
    return DomainAuthorizationService.assertPermission(context, permission);
  }

  static async resolve(input: {
    orgId: string;
    permission: AccountingPermission;
    userId: string;
    workspaceOrgId?: string;
  }): Promise<AuthorizedAccountingContext> {
    const context = await this.resolveAccess(input);
    return this.assertPermission(context, input.permission);
  }
}

export { accessModeForRole } from "./effective-organization-access-service";
