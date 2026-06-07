import { Routes } from '@angular/router';

import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { LoginPage } from '../../domains/identity/feature/login/login.page';
import { SelectWorkspacePage } from '../../domains/identity/feature/select-workspace/select-workspace.page';
import { SignupPage } from '../../domains/identity/feature/signup/signup.page';
import {
  appRootRedirectGuard,
  authGuard,
  cabinetDashboardGuard,
  cabinetDossierGuard,
  loginRedirectGuard,
  tenantGuard
} from './auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPage,
    canActivate: [loginRedirectGuard]
  },
  {
    path: 'signup',
    component: SignupPage,
    canActivate: [loginRedirectGuard]
  },
  {
    path: 'auth/callback',
    component: AuthCallbackPage
  },
  {
    path: 'select-workspace',
    component: SelectWorkspacePage,
    canActivate: [authGuard]
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('../../domains/identity/feature/onboarding/onboarding.page').then(
        (module) => module.OnboardingPage
      ),
    canActivate: [authGuard]
  },
  {
    path: 'cabinet/dossiers/select',
    loadComponent: () =>
      import(
        '../../domains/identity/feature/cabinet-dossier-select/cabinet-dossier-select.page'
      ).then((module) => module.CabinetDossierSelectPage),
    canActivate: [cabinetDossierGuard]
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../../shared/layout/app-shell/app-shell.component').then(
        (module) => module.AppShellComponent
      ),
    canActivate: [appRootRedirectGuard]
  },
  {
    path: '',
    loadComponent: () =>
      import('../../shared/layout/app-shell/app-shell.component').then(
        (module) => module.AppShellComponent
      ),
    canActivate: [authGuard, tenantGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('../feature/dashboard/dashboard.page').then((module) => module.DashboardPage)
      },
      {
        path: 'cabinet/dashboard',
        loadComponent: () =>
          import('../../domains/identity/feature/cabinet-dashboard/cabinet-dashboard.page').then(
            (module) => module.CabinetDashboardPage
          ),
        canActivate: [cabinetDashboardGuard]
      },
      {
        path: 'cabinet/dossiers',
        loadComponent: () =>
          import('../../domains/identity/feature/cabinet-dossiers/cabinet-dossiers.page').then(
            (module) => module.CabinetDossiersPage
          ),
        canActivate: [cabinetDashboardGuard]
      },
      {
        path: 'cabinet/dossiers/new',
        loadComponent: () =>
          import(
            '../../domains/identity/feature/cabinet-dossier-new/cabinet-dossier-new.page'
          ).then((module) => module.CabinetDossierNewPage),
        canActivate: [cabinetDashboardGuard]
      },
      {
        path: 'accounting/general-ledger',
        loadComponent: () =>
          import('../../domains/accounting/feature/general-ledger/general-ledger.page').then(
            (module) => module.GeneralLedgerPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.GENERAL_LEDGER.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.GENERAL_LEDGER.TITLE'
        }
      },
      {
        path: 'accounting/journals',
        loadComponent: () =>
          import('../../domains/accounting/feature/journals/journals.page').then(
            (module) => module.JournalsPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.JOURNALS.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.JOURNALS.TITLE'
        }
      },
      {
        path: 'accounting/entries',
        loadComponent: () =>
          import('../../domains/accounting/feature/entries/entries.page').then(
            (module) => module.EntriesPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.ENTRIES.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.ENTRIES.TITLE'
        }
      },
      {
        path: 'accounting/trial-balance',
        loadComponent: () =>
          import('../../domains/accounting/feature/trial-balance/trial-balance.page').then(
            (module) => module.TrialBalancePage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.TRIAL_BALANCE.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.TRIAL_BALANCE.TITLE'
        }
      },
      {
        path: 'accounting/chart-of-accounts',
        loadComponent: () =>
          import('../../domains/accounting/feature/chart-of-accounts/chart-of-accounts.page').then(
            (module) => module.ChartOfAccountsPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.TITLE'
        }
      }
    ]
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard'
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
