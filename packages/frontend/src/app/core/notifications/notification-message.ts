import { HttpErrorResponse } from '@angular/common/http';

const TECHNICAL_MESSAGE_PATTERNS = [
  /\bPK\b/i,
  /\bSK\b/i,
  /\bGSI\d*\b/i,
  /stack/i,
  /trace/i,
  /exception/i,
  /aws/i,
  /dynamodb/i,
  /lambda/i,
  /conditionalcheckfailed/i
];

export interface ApiMutationResult<T> {
  data: T;
  message: string | null;
}

export function userMessageFromResponse(response: unknown): string | null {
  return firstSafeMessage(response);
}

export function safeMessageFromError(error: unknown): string | null {
  if (error instanceof HttpErrorResponse) {
    return firstSafeMessage(error.error);
  }

  return firstSafeMessage(error);
}

function firstSafeMessage(value: unknown): string | null {
  const candidate = firstMessage(value);

  if (!candidate || isTechnicalMessage(candidate)) {
    return null;
  }

  return candidate;
}

function firstMessage(value: unknown): string | null {
  const directText = text(value);

  if (directText) {
    return directText;
  }

  if (!isRecord(value)) {
    return null;
  }

  const messageValue = value['message'];
  const directMessage = text(messageValue);

  if (directMessage) {
    return directMessage;
  }

  if (isRecord(messageValue)) {
    const nestedMessage = firstMessage(messageValue);

    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const nestedError = value['error'];

  if (isRecord(nestedError)) {
    const nestedMessage = firstMessage(nestedError);

    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const errors = value['errors'];

  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const message = firstMessage(entry);

      if (message) {
        return message;
      }
    }
  }

  return null;
}

function isTechnicalMessage(message: string): boolean {
  return TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
