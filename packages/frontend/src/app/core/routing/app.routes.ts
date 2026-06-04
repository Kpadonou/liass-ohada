import { Routes } from '@angular/router';

import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { LoginPage } from '../../domains/identity/feature/login/login.page';
import { SelectWorkspacePage } from '../../domains/identity/feature/select-workspace/select-workspace.page';
import { SignupPage } from '../../domains/identity/feature/signup/signup.page';
import { authGuard, cabinetDossierGuard, loginRedirectGuard, tenantGuard } from './auth.guards';

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
    path: 'cabinet/dossiers/new',
    loadComponent: () =>
      import('../../domains/identity/feature/cabinet-dossier-new/cabinet-dossier-new.page').then(
        (module) => module.CabinetDossierNewPage
      ),
    canActivate: [cabinetDossierGuard]
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
    path: 'dashboard',
    loadComponent: () =>
      import('../../shared/layout/app-shell/app-shell.component').then(
        (module) => module.AppShellComponent
      ),
    canActivate: [authGuard, tenantGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('../feature/dashboard/dashboard.page').then((module) => module.DashboardPage)
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
