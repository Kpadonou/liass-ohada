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
        path: 'projects',
        loadComponent: () =>
          import('../../domains/projects/feature/projects.page').then(
            (module) => module.ProjectsPage
          ),
        data: {
          subtitleKey: 'PROJECTS.PAGE.SUBTITLE',
          titleKey: 'PROJECTS.PAGE.TITLE'
        }
      },
      {
        path: 'projects/:projectId',
        loadComponent: () =>
          import('../../domains/projects/feature/project-detail.page').then(
            (module) => module.ProjectDetailPage
          ),
        data: {
          subtitleKey: 'PROJECTS.DETAIL.ROUTE_SUBTITLE',
          titleKey: 'PROJECTS.DETAIL.ROUTE_TITLE'
        }
      },
      {
        path: 'treasury',
        loadComponent: () =>
          import('../../domains/treasury/feature/treasury.page').then(
            (module) => module.TreasuryPage
          ),
        data: {
          subtitleKey: 'TREASURY.PAGE.SUBTITLE',
          titleKey: 'TREASURY.PAGE.TITLE'
        }
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
        path: 'accounting',
        pathMatch: 'full',
        loadComponent: () =>
          import('../../domains/accounting/feature/accounting-overview/accounting-overview.page').then(
            (module) => module.AccountingOverviewPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.OVERVIEW.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.OVERVIEW.TITLE'
        }
      },
      {
        path: 'accounting/fiscal-year',
        pathMatch: 'full',
        redirectTo: '/accounting/fiscal-years'
      },
      {
        path: 'accounting/fiscal-years',
        loadComponent: () =>
          import('../../domains/accounting/feature/fiscal-year/fiscal-year.page').then(
            (module) => module.FiscalYearPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.FISCAL_YEAR.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.FISCAL_YEAR.TITLE'
        }
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
        path: 'accounting/auxiliary-ledger',
        loadComponent: () =>
          import('../../domains/accounting/feature/auxiliary-ledger/auxiliary-ledger.page').then(
            (module) => module.AuxiliaryLedgerPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.AUXILIARY_LEDGER.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.AUXILIARY_LEDGER.TITLE'
        }
      },
      {
        path: 'accounting/journal-book',
        loadComponent: () =>
          import('../../domains/accounting/feature/journal-book/journal-book.page').then(
            (module) => module.JournalBookPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.JOURNAL_BOOK.SUBTITLE',
          titleKey: 'ACCOUNTING.JOURNAL_BOOK.TITLE'
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
        path: 'accounting/third-parties',
        loadComponent: () =>
          import('../../domains/accounting/feature/third-parties/third-parties.page').then(
            (module) => module.ThirdPartiesPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.THIRD_PARTIES.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.THIRD_PARTIES.TITLE'
        }
      },
      {
        path: 'accounting/entries/new',
        loadComponent: () =>
          import('../../domains/accounting/feature/entry-form/entry-form.page').then(
            (module) => module.EntryFormPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.ENTRIES.FORM.NEW_SUBTITLE',
          titleKey: 'ACCOUNTING.ENTRIES.FORM.NEW_TITLE'
        }
      },
      {
        path: 'accounting/entries/:entryId/edit',
        loadComponent: () =>
          import('../../domains/accounting/feature/entry-form/entry-form.page').then(
            (module) => module.EntryFormPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.ENTRIES.FORM.EDIT_SUBTITLE',
          titleKey: 'ACCOUNTING.ENTRIES.FORM.EDIT_TITLE'
        }
      },
      {
        path: 'accounting/entries/:entryId',
        loadComponent: () =>
          import('../../domains/accounting/feature/entry-detail/entry-detail.page').then(
            (module) => module.EntryDetailPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.ENTRIES.DETAIL.SUBTITLE',
          titleKey: 'ACCOUNTING.ENTRIES.DETAIL.TITLE'
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
        path: 'accounting/lettering',
        loadComponent: () =>
          import('../../domains/accounting/feature/lettering/lettering.page').then(
            (module) => module.LetteringPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.LETTERING.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.LETTERING.TITLE'
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
        path: 'accounting/accounts',
        loadComponent: () =>
          import('../../domains/accounting/feature/accounts/accounts.page').then(
            (module) => module.AccountsPage
          ),
        data: {
          subtitleKey: 'ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.SUBTITLE',
          titleKey: 'ACCOUNTING.PAGES.CHART_OF_ACCOUNTS.TITLE'
        }
      },
      {
        path: 'accounting/chart-of-accounts',
        redirectTo: '/accounting/accounts',
        pathMatch: 'full'
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
