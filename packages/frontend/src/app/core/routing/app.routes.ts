import { Routes } from '@angular/router';

import { DashboardPage } from '../../domains/dashboard/feature/dashboard/dashboard.page';
import { LoginPage } from '../../domains/identity/feature/login/login.page';
import { SelectWorkspacePage } from '../../domains/identity/feature/select-workspace/select-workspace.page';
import { authGuard, loginRedirectGuard, tenantGuard } from './auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPage,
    canActivate: [loginRedirectGuard]
  },
  {
    path: 'select-workspace',
    component: SelectWorkspacePage,
    canActivate: [authGuard]
  },
  {
    path: 'dashboard',
    component: DashboardPage,
    canActivate: [authGuard, tenantGuard]
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
