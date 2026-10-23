import { Routes } from '@angular/router';
export const guestRoutes: Routes = [
  {
    path: 'g/:opaqueTableToken',
    loadComponent: () =>
      import('../../domains/restaurants/feature/restaurant-guest.page').then(
        (m) => m.RestaurantGuestPage,
      ),
  },
];
