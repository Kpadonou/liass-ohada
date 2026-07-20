import { Injectable } from '@angular/core';

const TOKEN_KEY = 'liass-ohada.cabinet-invitation-token';
const RETURN_URL_KEY = 'liass-ohada.auth-return-url';
const ACCEPTANCE_PATH = '/accept-invitation';

function storage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export function clearInvitationAcceptanceState(): void {
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(RETURN_URL_KEY);
}

@Injectable({ providedIn: 'root' })
export class InvitationAcceptanceState {
  captureToken(token: string): boolean {
    const value = token.trim();
    if (value.length < 32 || value.length > 512) return false;
    storage()?.setItem(TOKEN_KEY, value);
    return true;
  }

  token(): string | null {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  }

  clearToken(): void {
    storage()?.removeItem(TOKEN_KEY);
  }

  rememberReturnToAcceptance(): void {
    storage()?.setItem(RETURN_URL_KEY, ACCEPTANCE_PATH);
  }

  consumeReturnUrl(): string | null {
    const value = storage()?.getItem(RETURN_URL_KEY) ?? null;
    storage()?.removeItem(RETURN_URL_KEY);
    return value === ACCEPTANCE_PATH ? value : null;
  }
}
