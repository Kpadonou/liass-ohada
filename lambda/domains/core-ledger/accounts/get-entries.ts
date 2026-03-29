import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { z } from "zod";

// On définit un schéma pour valider les paramètres de recherche si besoin
// Sinon, on utilise z.any() ou z.object({}) si le body est vide
const EmptySchema = z.object({});

export const handler = createHandler(
  EmptySchema,
  async (_, { orgId, i18n, event }) => {
    // 1. Extraction des paramètres (Path & Query)
    const { fiscalYear, accountId } = event.pathParameters || {};
    const limitStr = event.queryStringParameters?.limit;
    const cursor = event.queryStringParameters?.cursor;

    // 2. Validations de base
    if (!fiscalYear || !accountId) {
      throw new AppError(400, "ERROR_INVALID_INPUT");
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    if (isNaN(limit) || limit <= 0 || limit > 1000) {
      throw new AppError(400, "ERROR_INVALID_LIMIT");
    }

    // 3. Appel au service (Notez l'appel via la classe LedgerService)
    const result = await LedgerService.getAccountEntries(
      orgId,
      fiscalYear,
      accountId,
      { limit, cursor },
    );

    // 4. Réponse
    return {
      message: i18n.getMessage("SUCCESS_ENTRIES_RETRIEVED"),
      ...result,
    };
  },
);
