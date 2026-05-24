import { Routes } from '@angular/router';

import { authGuard, loginRedirectGuard, tenantGuard } from './auth/auth.guards';
import { DashboardPage } from './pages/dashboard/dashboard.page';
import { LoginPage } from './pages/login/login.page';
import { SelectWorkspacePage } from './pages/select-workspace/select-workspace.page';

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
