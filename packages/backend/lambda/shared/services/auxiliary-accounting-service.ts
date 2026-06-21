import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import {
  resolveAuxiliaryMetadata,
} from "@/lambda/shared/account-auxiliary";
import { BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  Account,
  CreateEntryRequest,
  ThirdPartyTypeValue,
} from "@liass-ohada/shared/accounting";
import { ThirdPartyService } from "./third-party-service";

export type ValidatedPostingLine = CreateEntryRequest["lines"][number] & {
  accountId: string;
  accountCode: string;
  accountLabel: string;
  thirdPartyId?: string;
  thirdPartyType?: ThirdPartyTypeValue;
  thirdPartyCode?: string;
  thirdPartyName?: string;
};

export class AuxiliaryAccountingService {
  static async validateAndEnrichLines(
    orgId: string,
    lines: CreateEntryRequest["lines"],
  ): Promise<ValidatedPostingLine[]> {
    const accountIds = [
      ...new Set(lines.map((line) => line.accountId.padEnd(8, "0"))),
    ];
    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: accountIds.map((accountId) =>
              marshall({
                PK: KeyFactory.orgKey(orgId),
                SK: KeyFactory.accountSK(accountId),
              }),
            ),
          },
        },
      }),
    );
    const accounts = new Map<string, Account>();
    for (const rawItem of result.Responses?.[config.TABLE_NAME] ?? []) {
      const account = unmarshall(rawItem) as Account;
      if (account.orgId === orgId) {
        accounts.set(account.accountId, account);
      }
    }
    if (!accountIds.every((accountId) => accounts.has(accountId))) {
      throw new AppError(400, "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND");
    }

    return Promise.all(
      lines.map(async (line) => {
        const accountId = line.accountId.padEnd(8, "0");
        const account = accounts.get(accountId)!;
        if (account.isActive === false) {
          throw new AppError(400, "ERROR_ACCOUNT_INACTIVE");
        }

        const metadata = resolveAuxiliaryMetadata(account);
        if (!metadata.requiresThirdParty) {
          if (line.thirdPartyId || line.thirdPartyType) {
            throw new AppError(400, "THIRD_PARTY_NOT_ALLOWED");
          }
          return {
            ...line,
            accountId,
            accountCode: accountId,
            accountLabel: account.accountName,
            thirdPartyId: undefined,
            thirdPartyType: undefined,
          };
        }

        if (!line.thirdPartyId) {
          throw new AppError(400, "THIRD_PARTY_REQUIRED");
        }

        const requiredType =
          metadata.auxiliaryType === "CUSTOMER" ||
          metadata.auxiliaryType === "SUPPLIER"
            ? metadata.auxiliaryType
            : line.thirdPartyType;
        if (!requiredType) {
          throw new AppError(400, "THIRD_PARTY_REQUIRED");
        }
        if (line.thirdPartyType && line.thirdPartyType !== requiredType) {
          throw new AppError(400, "THIRD_PARTY_TYPE_MISMATCH");
        }

        const thirdParty = await ThirdPartyService.getItem(
          orgId,
          requiredType,
          line.thirdPartyId,
        );
        if (thirdParty.status !== "ACTIVE") {
          throw new AppError(400, "THIRD_PARTY_INACTIVE");
        }
        if (
          metadata.auxiliaryType !== "THIRD_PARTY" &&
          thirdParty.type !== metadata.auxiliaryType
        ) {
          throw new AppError(400, "THIRD_PARTY_TYPE_MISMATCH");
        }

        return {
          ...line,
          accountId,
          accountCode: accountId,
          accountLabel: account.accountName,
          thirdPartyId: thirdParty.thirdPartyId,
          thirdPartyType: thirdParty.type,
          thirdPartyCode: thirdParty.code,
          thirdPartyName: thirdParty.displayName,
        };
      }),
    );
  }
}
