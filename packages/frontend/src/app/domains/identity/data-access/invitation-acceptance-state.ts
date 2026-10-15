import { Injectable } from '@angular/core';

const TOKEN_KEY = 'liass-ohada.cabinet-invitation-token';
const RETURN_URL_KEY = 'liass-ohada.auth-return-url';
const ACCEPTANCE_PATH = '/accept-invitation';
const COMPANY_PATH = '/accept-company-invitation';
const USER_KEY = 'liass-ohada.invitation-user';
const KIND_KEY = 'liass-ohada.invitation-kind';

function storage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export function clearInvitationAcceptanceState(): void {
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(KIND_KEY);
  storage()?.removeItem(USER_KEY);
  storage()?.removeItem(RETURN_URL_KEY);
}

@Injectable({ providedIn: 'root' })
export class InvitationAcceptanceState {
  captureToken(token: string, company = false): boolean {
    const value = token.trim();
    if (company ? !/^[A-Za-z0-9_-]{43}$/.test(value) : value.length < 32 || value.length > 512) {
      this.clearToken();
      return false;
    }
    clearInvitationAcceptanceState();
    storage()?.setItem(KIND_KEY, company ? 'COMPANY' : 'CABINET');
    storage()?.setItem(TOKEN_KEY, value);
    return true;
  }

  token(): string | null {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  }

  isCompany(): boolean {
    return storage()?.getItem(KIND_KEY) === 'COMPANY';
  }

  clearToken(): void {
    clearInvitationAcceptanceState();
  }

  bindUser(user: string): boolean {
    const previous = storage()?.getItem(USER_KEY);
    if (previous && previous !== user) {
      this.clearToken();
      return false;
    }
    if (this.token()) storage()?.setItem(USER_KEY, user);
    return !!this.token();
  }

  rememberReturnToAcceptance(company = this.isCompany()): void {
    storage()?.setItem(RETURN_URL_KEY, company ? COMPANY_PATH : ACCEPTANCE_PATH);
  }

  consumeReturnUrl(): string | null {
    const value = storage()?.getItem(RETURN_URL_KEY) ?? null;
    storage()?.removeItem(RETURN_URL_KEY);
    return value === ACCEPTANCE_PATH || value === COMPANY_PATH ? value : null;
  }
}
