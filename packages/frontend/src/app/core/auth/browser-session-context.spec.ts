import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';
import { AuthStore } from '../../domains/identity/data-access/auth.store';
import { BrowserSessionContext, REFRESH_BROWSER_CONTEXT } from './browser-session-context';

describe('Global browser workspace context', () => {
  const revision = signal(0);
  const invalidateSessionContext = vi.fn(() => revision.update((v) => v + 1));
  const refresh = vi.fn(),
    closeAll = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    revision.set(0);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { contextRevision: revision, invalidateSessionContext } },
        { provide: REFRESH_BROWSER_CONTEXT, useValue: refresh },
        { provide: MatDialog, useValue: { closeAll } },
      ],
    });
    TestBed.inject(BrowserSessionContext);
    TestBed.tick();
  });
  afterEach(() => TestBed.resetTestingModule());
  it.each([
    'liass-ohada.activeOrgId',
    'liass-ohada.activeDossierOrgId',
    'CognitoIdentityServiceProvider.pool.LastAuthUser',
    null,
  ])('invalidates before refreshing after an external change to %s', (key) => {
    refresh.mockImplementationOnce(() => expect(invalidateSessionContext).toHaveBeenCalledOnce());
    window.dispatchEvent(
      new StorageEvent('storage', { key, oldValue: key ? 'a' : null, newValue: key ? 'b' : null }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    TestBed.tick();
    expect(closeAll).toHaveBeenCalledOnce();
  });
  it('preserves local context for unrelated preferences', () => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'liass-ohada.language', oldValue: 'fr', newValue: 'en' }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
