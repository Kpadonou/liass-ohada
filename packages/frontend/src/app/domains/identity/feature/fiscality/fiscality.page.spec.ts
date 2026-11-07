import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { FiscalityPage } from './fiscality.page';
import { FiscalConnectionDialogComponent } from './fiscal-connection-dialog.component';
import { FiscalityApi } from '../../data-access/fiscality.api';
import { NotificationService } from '../../../../core/notifications/notification.service';
import fr from '../../../../../../public/assets/i18n/fr.json';

const context = { org: 'org-a', user: 'owner', revision: 1 };
const connection = {
  connectionId: crypto.randomUUID(),
  label: 'Connexion de test',
  environment: 'TEST',
  version: 1,
  credentialStatus: 'ABSENT',
  updatedAt: '2026-11-07T12:00:00.000Z',
};
const current = signal(true);
const api = {
  context: () => context,
  current: () => current(),
  approval: vi.fn(),
  list: vi.fn(),
  change: vi.fn(),
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const notification = { success: vi.fn(), error: vi.fn() };
const translations = () =>
  TranslocoTestingModule.forRoot({
    langs: { fr },
    translocoConfig: { availableLangs: ['fr'], defaultLang: 'fr' },
    preloadLangs: true,
  });
beforeEach(() => {
  vi.resetAllMocks();
  current.set(true);
  client.clear();
  api.approval.mockResolvedValue({ status: 'UNAVAILABLE', approval: null });
  api.list.mockResolvedValue({ connections: [connection], canManage: true, environment: 'TEST' });
  TestBed.configureTestingModule({
    imports: [FiscalityPage, FiscalConnectionDialogComponent, translations()],
    providers: [
      { provide: FiscalityApi, useValue: api },
      { provide: QueryClient, useValue: client },
      { provide: NotificationService, useValue: notification },
    ],
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  client.clear();
});
it('shows truthful unavailable approval and blocked issuance with canonical table/mobile structure', async () => {
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Connexion de test');
  });
  expect(fixture.nativeElement.textContent).toContain('Références officielles non enregistrées');
  expect(fixture.nativeElement.textContent).toContain('Émission fiscale non activée');
  expect(fixture.nativeElement.querySelector('table.liass-data-table')).toBeTruthy();
  expect(fixture.nativeElement.querySelector('input[type=password]')).toBeFalsy();
  expect(fixture.nativeElement.querySelector('a[download]')).toBeFalsy();
});
it('reuses a fresh cached collection on remount', async () => {
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.connections().length).toBe(1);
  });
  fixture.destroy();
  const second = TestBed.createComponent(FiscalityPage);
  second.detectChanges();
  expect(second.componentInstance.connections().length).toBe(1);
  expect(api.list).toHaveBeenCalledTimes(1);
});
it('hides management actions for read-only company members', async () => {
  api.list.mockResolvedValue({ connections: [connection], canManage: false, environment: 'TEST' });
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.connections().length).toBe(1);
  });
  expect(fixture.nativeElement.querySelector('button[aria-label="Actions"]')).toBeFalsy();
  expect(fixture.nativeElement.textContent).not.toContain('Ajouter une connexion');
});
it('clears token before submission and never places it in query or mutation cache', async () => {
  const ref = { close: vi.fn(), disableClose: false };
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: { context, environment: 'TEST', kind: 'STORE_CREDENTIAL', connection },
  });
  TestBed.overrideProvider(MatDialogRef, { useValue: ref });
  const fixture = TestBed.createComponent(FiscalConnectionDialogComponent);
  fixture.detectChanges();
  const token = 'a.b.synthetic';
  fixture.componentInstance.form.controls.token.setValue(token);
  let resolve!: (value: unknown) => void;
  api.change.mockImplementation(() => new Promise((done) => (resolve = done)));
  const pending = fixture.componentInstance.submit();
  expect(fixture.componentInstance.form.controls.token.value).toBe('');
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(token);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  resolve({
    data: { ...connection, credentialStatus: 'STORED_UNVERIFIED' },
    message: 'Enregistré',
  });
  await pending;
  expect(ref.close).toHaveBeenCalledWith(true);
});
