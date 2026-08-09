import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { BudgetService } from "@/lambda/domains/projects/services/budget-service";
import { BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

const ProjectReferenceInputSchema = z
  .object({
    orgId: z.string().min(1),
    projectIds: z.array(z.string().min(1)).max(49),
  })
  .strict();

const PostingLineReferenceInputSchema = z
  .object({
    orgId: z.string().min(1),
    year: z.number().int(),
    projectId: z.string().min(1).optional(),
    budgetLineId: z.string().min(1).optional(),
    donorId: z.string().min(1).optional(),
    debit: z.number().int().nonnegative(),
    credit: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Project Accounting-owned application boundary for analytical references used
 * by Accounting posting. It owns Project persistence keys and delegates the
 * existing Project budget/cash rules without exposing persistence metadata.
 */
export class ProjectAccountingReferenceService {
  static async validateAccountingReferences(input: {
    orgId: string;
    projectIds: string[];
  }): Promise<void> {
    const parsed = ProjectReferenceInputSchema.parse(input);
    const projectIds = [...new Set(parsed.projectIds)];
    if (projectIds.length === 0) return;

    const organizationKey = KeyFactory.orgKey(parsed.orgId);
    const expectedProjectKeys = new Map(
      projectIds.map((projectId) => [
        KeyFactory.projectSK(projectId),
        projectId,
      ]),
    );
    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: [...expectedProjectKeys.keys()].map((SK) =>
              marshall({ PK: organizationKey, SK }),
            ),
          },
        },
      }),
    );

    const foundProjectIds = new Set<string>();
    for (const rawItem of result.Responses?.[config.TABLE_NAME] ?? []) {
      const item = unmarshall(rawItem);
      if (item.PK !== organizationKey || typeof item.SK !== "string") {
        continue;
      }
      const projectId = expectedProjectKeys.get(item.SK);
      if (projectId) foundProjectIds.add(projectId);
    }

    if (!projectIds.every((projectId) => foundProjectIds.has(projectId))) {
      throw new AppError(400, "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND");
    }
  }

  static async validatePostingLine(input: {
    orgId: string;
    year: number;
    projectId?: string;
    budgetLineId?: string;
    donorId?: string;
    debit: number;
    credit: number;
  }): Promise<void> {
    const parsed = PostingLineReferenceInputSchema.parse(input);
    if (!parsed.projectId || parsed.debit <= 0) return;

    await BudgetService.enforceBudget(parsed.orgId, parsed.year, parsed);
  }
}
