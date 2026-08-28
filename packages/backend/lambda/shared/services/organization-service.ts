import { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { Organization } from "@liass-ohada/shared";
import { z } from "zod";
import { OrganizationRepository } from "../repositories/organization-repository";

const OrganizationIdSchema = z.string().min(1);

export class OrganizationService {
  static async getOrganization(orgId: string): Promise<Organization | null> {
    return OrganizationRepository.getOrganization(
      OrganizationIdSchema.parse(orgId),
    );
  }

  static buildActiveCompanyCondition(orgId: string): TransactWriteItem {
    return OrganizationRepository.buildActiveCompanyCondition(
      OrganizationIdSchema.parse(orgId),
    );
  }
}
