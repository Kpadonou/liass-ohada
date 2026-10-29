import { describe, expect, it, vi } from 'vitest';

import { pageFromUrl } from './app-shell.component';

vi.mock('aws-amplify/auth', () => {
  const globalScope = globalThis as unknown as {
    __liassAmplifyAuthMock?: Record<string, ReturnType<typeof vi.fn>>;
  };
  globalScope.__liassAmplifyAuthMock ??= {
    confirmSignIn: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchUserAttributes: vi.fn(),
    getCurrentUser: vi.fn(),
    signIn: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn(),
  };

  return globalScope.__liassAmplifyAuthMock;
});

describe('pageFromUrl', () => {
  it('maps direct cabinet URLs to their cabinet shell pages', () => {
    expect(pageFromUrl('/cabinet/team')).toBe('cabinet.team');
    expect(pageFromUrl('/cabinet/team?tab=members')).toBe('cabinet.team');
    expect(pageFromUrl('/cabinet/dashboard')).toBe('cabinet.dashboard');
    expect(pageFromUrl('/cabinet/dossiers')).toBe('cabinet.dossiers');
    expect(pageFromUrl('/cabinet/settings')).toBe('cabinet.settings');
  });

  it('maps direct accounting child URLs to their shell page', () => {
    expect(pageFromUrl('/accounting/auxiliary-balance')).toBe('accounting.auxiliaryBalance');
    expect(pageFromUrl('/accounting/auxiliary-balance?status=ACTIVE')).toBe(
      'accounting.auxiliaryBalance',
    );
    expect(pageFromUrl('/accounting/auxiliary-ledger')).toBe('accounting.auxiliaryLedger');
    expect(pageFromUrl('/accounting/reports/simplified')).toBe('accounting.overview');
    expect(pageFromUrl('/accounting/reports/simplified?fiscalYear=2026')).toBe(
      'accounting.overview',
    );
    expect(pageFromUrl('/accounting')).toBe('accounting.overview');
  });

  it('maps each implemented SALES foundation to its distinct shell page', () => {
    expect(pageFromUrl('/sales')).toBe('sales.dashboard');
    expect(pageFromUrl('/sales/?view=all')).toBe('sales.dashboard');
    expect(pageFromUrl('/sales/customers')).toBe('sales.customers');
    expect(pageFromUrl('/sales/items')).toBe('sales.items');
    expect(pageFromUrl('/sales/items?cursor=opaque')).toBe('sales.items');
    expect(pageFromUrl('/sales/invoices')).toBe('sales.invoices');
    expect(pageFromUrl('/sales/invoices/INV-1')).toBe('sales.invoices');
  });
});

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { MatButtonModule } from '@angular/material/button';
import { AppShellComponent } from './app-shell.component';
import { ShellProductNavigation } from '../../../core/navigation/product-navigation';
import { UiStore } from '../../../core/state/ui.store';
import { AuthStore } from '../../../domains/identity/data-access/auth.store';
import { LiassLogoComponent } from '../../ui/liass-logo/liass-logo.component';
import fr from '../../../../../public/assets/i18n/fr.json';

@Component({ selector: 'liass-app-topbar', template: 'Normal application header' })
class Topbar {}
@Component({
  selector: 'liass-app-sidebar',
  template:
    'Dashboard Service Cash Kitchen Stock Restaurant Établissements Espaces Tables Postes Menu Équipe',
})
class Sidebar {}
@Component({ selector: 'liass-app-context-breadcrumb', template: 'Functional breadcrumb' })
class Breadcrumb {}
@Component({ selector: 'liass-app-backdrop', template: '' })
class Backdrop {}
@Component({ template: 'Choisir votre établissement' })
class Entry {}

describe('Restaurants isolated session entry shell', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('mounts only branding/logout and entry until ready, then makes normal shell available', async () => {
    const entry = signal(true);
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { fr },
          preloadLangs: true,
          translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
        }),
      ],
      providers: [
        provideRouter([
          {
            path: 'restaurants',
            component: AppShellComponent,
            children: [{ path: 'context', component: Entry }],
          },
        ]),
        {
          provide: ShellProductNavigation,
          useValue: { restaurantEntry: entry, hasSidebar: () => !entry() },
        },
        {
          provide: UiStore,
          useValue: {
            applyTheme: () => {},
            setCurrentPage: () => {},
            sidebarCollapsed: () => false,
          },
        },
        { provide: AuthStore, useValue: { logout: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(AppShellComponent, {
      set: {
        imports: [
          RouterOutlet,
          Topbar,
          Sidebar,
          Breadcrumb,
          Backdrop,
          LiassLogoComponent,
          MatButtonModule,
          TranslocoTestingModule,
        ],
      },
    });
    const h = await RouterTestingHarness.create('/restaurants/context');
    expect(h.routeNativeElement?.textContent).toContain('Choisir votre établissement');
    expect(
      h.routeNativeElement?.querySelector(
        'liass-app-topbar,liass-app-sidebar,liass-app-context-breadcrumb',
      ),
    ).toBeNull();
    for (const label of [
      'Dashboard',
      'Service',
      'Cash',
      'Kitchen',
      'Stock',
      'Restaurant Établissements',
      'Espaces',
      'Tables',
      'Postes',
      'Menu',
      'Équipe',
    ])
      expect(h.routeNativeElement?.textContent).not.toContain(label);
    entry.set(false);
    h.detectChanges();
    expect(h.routeNativeElement?.querySelector('liass-app-topbar')).not.toBeNull();
    expect(h.routeNativeElement?.querySelector('liass-app-sidebar')).not.toBeNull();
    expect(h.routeNativeElement?.querySelector('liass-app-context-breadcrumb')).not.toBeNull();
  });
});
