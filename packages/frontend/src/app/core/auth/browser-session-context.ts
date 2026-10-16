import { MatDialog } from '@angular/material/dialog';
import { DestroyRef, Injectable, InjectionToken, inject, effect } from '@angular/core';
import { AuthStore } from '../../domains/identity/data-access/auth.store';

export const REFRESH_BROWSER_CONTEXT = new InjectionToken<() => void>('refresh browser context', {
  providedIn: 'root',
  factory: () => () => window.location.replace('/dashboard'),
});

/** The persisted workspace and Cognito session are shared by all tabs on this origin. */
@Injectable({ providedIn: 'root' })
export class BrowserSessionContext {
  private readonly auth = inject(AuthStore);
  private readonly refresh = inject(REFRESH_BROWSER_CONTEXT);
  constructor() {
    const dialogs = inject(MatDialog);
    let revision = this.auth.contextRevision();
    effect(() => {
      const next = this.auth.contextRevision();
      if (next !== revision) {
        revision = next;
        dialogs.closeAll();
      }
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      const contextChanged =
        event.key === null ||
        event.key === 'liass-ohada.activeOrgId' ||
        event.key === 'liass-ohada.activeDossierOrgId' ||
        (event.key?.startsWith('CognitoIdentityServiceProvider.') &&
          event.key.endsWith('.LastAuthUser'));
      if (!contextChanged || (event.key !== null && event.oldValue === event.newValue)) return;
      // Clear permissions and data synchronously, before guards establish the new context.
      this.auth.invalidateSessionContext();
      this.refresh();
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }
}
