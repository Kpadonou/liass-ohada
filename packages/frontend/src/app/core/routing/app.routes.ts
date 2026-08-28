import { Routes } from '@angular/router';

import { publicLandingHostGuard } from '../public/public-site.guard';
import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { LoginPage } from '../../domains/identity/feature/login/login.page';
import { SelectWorkspacePage } from '../../domains/identity/feature/select-workspace/select-workspace.page';
import { SignupPage } from '../../domains/identity/feature/signup/signup.page';
import {
  accountingWriteGuard,
  appRootRedirectGuard,
  authGuard,
  cabinetDashboardGuard,
  cabinetSettingsGuard,
  cabinetTeamGuard,
  cabinetDossierGuard,
  loginRedirectGuard,
  invitationAcceptanceGuard,
  pendingChangesGuard,
  tenantGuard
} from './auth.guards';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canMatch: [publicLandingHostGuard],
    loadComponent: () =>
      import('../public/public-landing.page').then((module) => module.PublicLandingPage)
  },
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
    path: 'accept-invitation',
    loadComponent: () =>
      import(
        '../../domains/identity/feature/invitation-acceptance/invitation-acceptance.page'
      ).then((module) => module.InvitationAcceptancePage),
    canActivate: [invitationAcceptanceGuard]
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
        path: 'sales',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'customers'
          },
          {
            path: 'customers',
            loadComponent: () =>
              import('../../domains/sales/feature/customers/sales-customers.page').then(
                (module) => module.SalesCustomersPage
              ),
            data: {
              subtitleKey: 'SALES.CUSTOMERS.PAGE.SUBTITLE',
              titleKey: 'SALES.CUSTOMERS.PAGE.TITLE'
            }
          }
        ]
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
        path: 'cabinet/works',
        loadComponent: () =>
          import('../../domains/identity/feature/cabinet-operations/cabinet-works.page').then(
            (module) => module.CabinetWorksPage
          ),
        canActivate: [cabinetDashboardGuard]
      },
      {
        path: 'cabinet/deadlines',
        loadComponent: () =>
          import(
            '../../domains/identity/feature/cabinet-operations/cabinet-deadlines.page'
          ).then((module) => module.CabinetDeadlinesPage),
        canActivate: [cabinetDashboardGuard]
      },
      {
        path: 'cabinet/team',
        loadComponent: () =>
          import('../../domains/identity/feature/cabinet-team/cabinet-team.page').then(
            (module) => module.CabinetTeamPage
          ),
        canActivate: [cabinetTeamGuard]
      },
      {
        path: 'cabinet/settings',
        loadComponent: () =>
          import('../../domains/identity/feature/cabinet-settings/cabinet-settings.page').then(
            (module) => module.CabinetSettingsPage
          ),
        canActivate: [cabinetSettingsGuard],
        canDeactivate: [pendingChangesGuard]
      },
      {
        path: 'accounting',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('../../domains/accounting/feature/simplified-reporting/simplified-reporting.page').then(
                (module) => module.SimplifiedReportingPage
              ),
            data: {
              subtitleKey: 'ACCOUNTING.PAGES.OVERVIEW.SUBTITLE',
              titleKey: 'ACCOUNTING.PAGES.OVERVIEW.TITLE'
            }
          },
          {
            path: 'fiscal-year',
            pathMatch: 'full',
            redirectTo: 'fiscal-years'
          },
          {
            path: 'fiscal-years',
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
            path: 'general-ledger',
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
            path: 'auxiliary-ledger',
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
            path: 'auxiliary-balance',
            loadComponent: () =>
              import('../../domains/accounting/feature/auxiliary-balance/auxiliary-balance.page').then(
                (module) => module.AuxiliaryBalancePage
              ),
            data: {
              subtitleKey: 'ACCOUNTING.PAGES.AUXILIARY_BALANCE.SUBTITLE',
              titleKey: 'ACCOUNTING.PAGES.AUXILIARY_BALANCE.TITLE'
            }
          },
          {
            path: 'journal-book',
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
            path: 'journals',
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
            path: 'third-parties',
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
            path: 'entries/new',
            loadComponent: () =>
              import('../../domains/accounting/feature/entry-form/entry-form.page').then(
                (module) => module.EntryFormPage
              ),
            canActivate: [accountingWriteGuard],
            data: {
              subtitleKey: 'ACCOUNTING.ENTRIES.FORM.NEW_SUBTITLE',
              titleKey: 'ACCOUNTING.ENTRIES.FORM.NEW_TITLE'
            }
          },
          {
            path: 'entries/:entryId/edit',
            loadComponent: () =>
              import('../../domains/accounting/feature/entry-form/entry-form.page').then(
                (module) => module.EntryFormPage
              ),
            canActivate: [accountingWriteGuard],
            data: {
              subtitleKey: 'ACCOUNTING.ENTRIES.FORM.EDIT_SUBTITLE',
              titleKey: 'ACCOUNTING.ENTRIES.FORM.EDIT_TITLE'
            }
          },
          {
            path: 'entries/:entryId',
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
            path: 'entries',
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
            path: 'lettering',
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
            path: 'trial-balance',
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
            path: 'reports/simplified',
            pathMatch: 'full',
            redirectTo: '/accounting'
          },
          {
            path: 'accounts',
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
            path: 'chart-of-accounts',
            redirectTo: 'accounts',
            pathMatch: 'full'
          }
        ]
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
