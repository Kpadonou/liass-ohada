import { Routes } from '@angular/router';

import { AuthCallbackPage } from '../../domains/identity/feature/auth-callback/auth-callback.page';
import { LoginPage } from '../../domains/identity/feature/login/login.page';
import { OnboardingPage } from '../../domains/identity/feature/onboarding/onboarding.page';
import { SelectWorkspacePage } from '../../domains/identity/feature/select-workspace/select-workspace.page';
import { SignupPage } from '../../domains/identity/feature/signup/signup.page';
import { authGuard, loginRedirectGuard, tenantGuard } from './auth.guards';

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
    component: OnboardingPage,
    canActivate: [authGuard]
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
