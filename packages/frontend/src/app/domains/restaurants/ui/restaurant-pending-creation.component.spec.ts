import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { beginPendingCreation } from '../../../core/query-cache/optimistic-name';
import { RestaurantPendingCreationComponent } from './restaurant-pending-creation.component';

it('renders a translated accessible pending item without dependent actions or network fetch', async () => {
  const client = new QueryClient(),
    key = ['restaurants', 'org', 'outlet', 'pending-creations'];
  TestBed.configureTestingModule({
    imports: [
      RestaurantPendingCreationComponent,
      TranslocoTestingModule.forRoot({
        langs: { en: { RESTAURANTS: { UI: { SAVING: 'Saving…' } } } },
        preloadLangs: true,
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      }),
    ],
    providers: [{ provide: QueryClient, useValue: client }],
  });
  const fixture = TestBed.createComponent(RestaurantPendingCreationComponent);
  fixture.componentRef.setInput('queryKey', key);
  fixture.detectChanges();
  const end = beginPendingCreation(client, key, 'New room');
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.querySelector('[role="status"]')?.textContent).toContain('New room · Saving…');
  expect(element.querySelector('[aria-busy="true"]')).toBeTruthy();
  expect(element.querySelector('button, a')).toBeNull();
  expect(client.getQueryState(key)?.fetchStatus).toBe('idle');
  end();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  expect(element.querySelector('[role="status"]')).toBeNull();
  fixture.destroy();
  client.clear();
  TestBed.resetTestingModule();
});
