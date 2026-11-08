import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { FiscalityPage } from './fiscality.page';
import { FiscalConnectionDialogComponent } from './fiscal-connection-dialog.component';
import { FiscalVerificationDialogComponent } from './fiscal-verification-dialog.component';
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
  verify: vi.fn(),
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const notification = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
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
    imports: [
      FiscalityPage,
      FiscalConnectionDialogComponent,
      FiscalVerificationDialogComponent,
      translations(),
    ],
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
  expect(fixture.nativeElement.textContent).toContain(
    'seuls les propriétaires de l’entreprise peuvent la modifier',
  );
});
it('distinguishes a loading failure from read-only access while keeping actions fail-closed', async () => {
  api.list.mockRejectedValue(new Error('private backend detail'));
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'La configuration fiscale n’a pas pu être chargée',
    );
  });
  expect(fixture.nativeElement.textContent).not.toContain('Ajouter une connexion');
  expect(fixture.nativeElement.textContent).not.toContain('seuls les propriétaires');
  expect(fixture.nativeElement.textContent).not.toContain('private backend detail');
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
it('verify respects owner/storage/environment restrictions and exposes in-progress state', async () => {
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.canManage()).toBe(true);
  });
  const eligible = {
    ...connection,
    credentialStatus: 'STORED_UNVERIFIED' as const,
    environment: 'TEST' as const,
  };
  let reject!: (error: unknown) => void;
  api.verify.mockImplementation(() => new Promise((_, fail) => (reject = fail)));
  const pending = fixture.componentInstance.verify(eligible);
  expect(fixture.componentInstance.verifying()).toBe(eligible.connectionId);
  expect(api.verify.mock.calls[0][1]).not.toHaveProperty('token');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  reject(new Error());
  await pending;
  expect(fixture.componentInstance.verifying()).toBeNull();
  expect(notification.error).toHaveBeenCalled();
  api.verify.mockClear();
  await fixture.componentInstance.verify({ ...eligible, environment: 'PRODUCTION' });
  await fixture.componentInstance.verify({ ...eligible, credentialStatus: 'ABSENT' });
  expect(api.verify).not.toHaveBeenCalled();
});
const technicalResult = (status = 'VERIFIED_TEST') => ({
  operationId: crypto.randomUUID(),
  environment: 'TEST',
  configurationVersion: 1,
  status,
  startedAt: '2026-11-07T12:00:00.000Z',
  completedAt: '2026-11-07T12:00:00.000Z',
  tokenValidUntil: '2026-11-08T12:00:00.000Z',
  inProgress: false,
  applicable: true,
  checks: {
    credentialStored: true,
    technicallyVerified: status === 'VERIFIED_TEST',
    notExpired: true,
    ifuConsistency: 'MATCH',
    nimCorrespondence: 'MATCH',
    emcfAssociation: 'UNVERIFIED',
    legalSellerAuthority: 'APPROVED',
    timezoneAuthority: 'UNVERIFIED',
    establishmentBinding: 'UNVERIFIED',
    sfeApprovalReferences: 'UNVERIFIED',
    sfeVersionApplicability: 'UNVERIFIED',
    executionAuthorized: false,
    issuanceEligible: false,
    productionEligible: false,
  },
});
it.each([
  ['VERIFIED_TEST', 'TEST techniquement vérifié'],
  ['PROVIDER_UNAVAILABLE', 'DGI momentanément indisponible'],
  ['VERIFICATION_NOT_ENABLED', 'Vérification non activée'],
])(
  'renders the actual verification result %s separately from saved credentials',
  async (status, label) => {
    const latestAttempt = technicalResult(status);
    api.list.mockResolvedValue({
      connections: [
        { ...connection, credentialStatus: 'STORED_UNVERIFIED', verification: { latestAttempt } },
      ],
      canManage: true,
      environment: 'TEST',
    });
    const fixture = TestBed.createComponent(FiscalityPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(label);
    });
    expect(fixture.nativeElement.textContent).toContain('Émission fiscale non activée');
    expect(fixture.nativeElement.textContent).toContain('Jeton enregistré');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  },
);
it('disabled verification gives informational feedback, not a false success', async () => {
  const fixture = TestBed.createComponent(FiscalityPage);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.componentInstance.canManage()).toBe(true);
  });
  api.verify.mockResolvedValue({
    data: technicalResult('VERIFICATION_NOT_ENABLED'),
    message: 'Vérification non activée',
  });
  await fixture.componentInstance.verify({
    ...connection,
    environment: 'TEST',
    credentialStatus: 'STORED_UNVERIFIED',
  });
  expect(notification.info).toHaveBeenCalledWith('Vérification non activée');
  expect(notification.success).not.toHaveBeenCalled();
});
it('details distinguish last successful evidence from latest failure and use the Benin display timezone', () => {
  TestBed.overrideProvider(MAT_DIALOG_DATA, {
    useValue: {
      ...connection,
      verification: {
        latestAttempt: technicalResult('PROVIDER_UNAVAILABLE'),
        lastVerified: technicalResult(),
      },
    },
  });
  const fixture = TestBed.createComponent(FiscalVerificationDialogComponent);
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('DGI momentanément indisponible');
  expect(fixture.nativeElement.textContent).toContain('Dernière réussite technique');
  expect(fixture.componentInstance.date('2026-11-07T12:00:00.000Z')).toContain('13:00');
  expect(fixture.nativeElement.textContent).toContain('n’active aucune émission fiscale');
});
