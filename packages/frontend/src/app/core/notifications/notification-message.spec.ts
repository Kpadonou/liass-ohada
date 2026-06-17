import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { safeMessageFromError, userMessageFromResponse } from './notification-message';

describe('notification message helpers', () => {
  it('extracts string from message', () => {
    expect(userMessageFromResponse({ message: 'Compte créé avec succès.' })).toBe(
      'Compte créé avec succès.'
    );
  });

  it('extracts nested string from message.message', () => {
    expect(
      userMessageFromResponse({
        message: {
          code: 'SUCCESS',
          message: 'Journal créé avec succès.'
        }
      })
    ).toBe('Journal créé avec succès.');
  });

  it('extracts string from error.message', () => {
    expect(safeMessageFromError({ error: { message: 'Le compte existe déjà.' } })).toBe(
      'Le compte existe déjà.'
    );
  });

  it('extracts nested string from error.error.message.message', () => {
    const error = new HttpErrorResponse({
      error: {
        error: {
          message: {
            code: 'ERROR_FISCAL_YEAR_ALREADY_EXISTS',
            message: "L'exercice existe déjà."
          }
        }
      },
      status: 409
    });

    expect(safeMessageFromError(error)).toBe("L'exercice existe déjà.");
  });

  it('extracts validation messages from error.error.errors[0].message', () => {
    expect(
      safeMessageFromError({
        error: {
          errors: [
            {
              message: 'Le champ année est obligatoire.'
            }
          ]
        }
      })
    ).toBe('Le champ année est obligatoire.');
  });

  it('returns null for technical messages so callers use translated fallbacks', () => {
    expect(
      safeMessageFromError({
        message: 'ConditionalCheckFailedException on PK ORG#1 and GSI1PK'
      })
    ).toBeNull();
  });
});
