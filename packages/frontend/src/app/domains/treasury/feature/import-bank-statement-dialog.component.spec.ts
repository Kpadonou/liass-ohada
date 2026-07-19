import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { TreasuryApi } from '../data-access/treasury.api';
import { TreasuryQueries } from '../data-access/treasury-queries';
import { ImportBankStatementDialogComponent } from './import-bank-statement-dialog.component';

const translations = {
  en: {
    COMMON: { ACTIONS: { CANCEL: 'Cancel', CLOSE: 'Close' }, EMPTY_VALUE: '—' },
    TREASURY: {
      IMPORT: {
        ACTION: 'Import statement',
        CONFIRM: 'Confirm import',
        DIALOG: {
          SUBTITLE: 'Upload an Excel or CSV file, review the preview, then confirm the import.',
          TITLE: 'Import bank statement'
        },
        ERRORS: { PARSE_FAILED: 'Parse failed.', SUBMIT_FAILED: 'Import failed.' },
        FILE: {
          CHOOSE: 'Choose file',
          COLUMNS: 'Expected columns.',
          HELP: 'Excel or CSV.',
          PARSING: 'Reading file...',
          SUPPORTED_FORMATS: 'Excel .xlsx or CSV',
          TITLE: 'File to import',
          UPLOAD_TITLE: 'Choose an Excel or CSV file'
        },
        PREVIEW: {
          BLOCKED: 'Fix invalid rows.',
          INVALID_HINT: 'Some rows contain errors. Fix the file and try again.',
          INFLOWS: 'Inflows',
          OUTFLOWS: 'Outflows',
          REJECTED_ROWS: 'Rejected',
          STATUS_INVALID: 'Invalid',
          STATUS_VALID: 'Valid',
          TABLE: { ROW: 'Row', STATUS: 'Check' },
          TOTAL_ROWS: 'Total rows',
          VALID_ROWS: 'Valid'
        },
        RESULT: '{{imported}} imported, {{skipped}} duplicate(s), {{rejected}} rejected',
        STEPS: {
          CONFIRMATION: 'Confirmation',
          FILE: 'File',
          LABEL: 'Import steps',
          PREVIEW: 'Preview'
        },
        TEMPLATE: {
          DOWNLOAD: 'Download template',
          HELP: 'Download the ready-to-fill Excel template.',
          QUESTION: 'Not sure which format to use?'
        },
        VALIDATION: {
          INVALID_AMOUNT: 'Invalid amount.',
          INVALID_DATE: 'Invalid date.',
          INVALID_DIRECTION: 'Invalid direction.',
          INVALID_ROW: 'Invalid row.',
          MISSING_HEADER: 'Missing header.',
          MISSING_REQUIRED_FIELDS: 'Missing fields.',
          UNSUPPORTED_FILE: 'Unsupported file.'
        }
      },
      STATEMENT: {
        DIRECTION: { INFLOW: 'Inflow', OUTFLOW: 'Outflow' },
        TABLE: {
          AMOUNT: 'Amount',
          DESCRIPTION: 'Description',
          DIRECTION: 'Direction',
          REFERENCE: 'Reference',
          STATEMENT_DATE: 'Statement date'
        }
      }
    }
  }
};

describe('ImportBankStatementDialogComponent', () => {
  let fixture: ComponentFixture<ImportBankStatementDialogComponent>;
  let treasuryApi: { importStatementLines: ReturnType<typeof vi.fn> };
  let queryClient: QueryClient;

  beforeEach(async () => {
    treasuryApi = {
      importStatementLines: vi.fn()
    };
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    TestBed.configureTestingModule({
      imports: [
        ImportBankStatementDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }
        })
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { treasuryAccountId: '52100000', year: '2026', currency: 'XOF' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: TreasuryApi, useValue: treasuryApi },
        {
          provide: TreasuryQueries,
          useValue: {
            statementLinesRootQueryKey: () => ['treasury', 'org-test', 'statement-lines', '52100000'],
            summaryRootQueryKey: () => ['treasury', 'org-test', 'summary']
          }
        },
        { provide: QueryClient, useValue: queryClient }
      ]
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(ImportBankStatementDialogComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('renders the downloadable template action before a file is selected', () => {
    expect(fixture.nativeElement.textContent).toContain('Download template');
    expect(fixture.nativeElement.textContent).not.toContain('The template uses the columns expected by Liass-OHADA.');
  });

  it('renders the improved title, subtitle, steps, and vertical file card', () => {
    const fileCard = fixture.nativeElement.querySelector('[data-testid="statement-file-card"]') as HTMLElement;

    expect(fixture.nativeElement.textContent).toContain('Import bank statement');
    expect(fixture.nativeElement.textContent).toContain('Upload an Excel or CSV file');
    expect(fixture.nativeElement.textContent).toContain('1. File');
    expect(fixture.nativeElement.textContent).toContain('2. Preview');
    expect(fixture.nativeElement.textContent).toContain('3. Confirmation');
    expect(fixture.nativeElement.textContent).toContain('File to import');
    expect(fixture.nativeElement.textContent).toContain('Choose an Excel or CSV file');
    expect(fileCard.className).toContain('space-y-4');
    expect(fileCard.className).not.toContain('lg:flex-row');
  });

  it('keeps choose file primary and confirm disabled before a valid preview', () => {
    const chooseButton = liassButtonWithText('Choose file');
    const confirmButton = liassButtonWithText('Confirm import');

    expect(chooseButton.tone()).toBe('brand');
    expect(chooseButton.variant()).toBe('solid');
    expect(confirmButton.disabled()).toBe(true);
    expect(confirmButton.variant()).toBe('soft');
  });

  it('downloads the template without calling the import backend', async () => {
    const downloadSpy = vi
      .spyOn(fixture.componentInstance as unknown as { downloadTemplate: () => Promise<void> }, 'downloadTemplate')
      .mockResolvedValue();

    const downloadButton = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.includes('Download template')
    ) as HTMLButtonElement | undefined;
    downloadButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(downloadSpy).toHaveBeenCalledOnce();
    expect(treasuryApi.importStatementLines).not.toHaveBeenCalled();
  });

  it('parses CSV preview and enables import only for valid rows', async () => {
    await uploadCsv('statementDate,description,amount,direction\n2026-01-15,Customer receipt,150000,INFLOW');

    const component = fixture.componentInstance as unknown as {
      canImport: () => boolean;
      preview: () => { validRows: unknown[]; invalidRows: unknown[] };
    };

    expect(component.preview().validRows).toHaveLength(1);
    expect(component.preview().invalidRows).toHaveLength(0);
    expect(component.canImport()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('statement.csv');
    expect(fixture.nativeElement.textContent).toContain('Total rows');
    expect(fixture.nativeElement.textContent).toContain('Valid');
    expect(fixture.nativeElement.textContent).toContain('Inflows');
    expect(fixture.nativeElement.textContent).toContain('Customer receipt');
    expect(liassButtonWithText('Confirm import').variant()).toBe('solid');
  });

  it('blocks invalid rows before submit', async () => {
    await uploadCsv('statementDate,description,amount,direction\n2026-01-15,Bad amount,-1,INFLOW');

    const component = fixture.componentInstance as unknown as {
      canImport: () => boolean;
      preview: () => { validRows: unknown[]; invalidRows: unknown[] };
    };

    expect(component.preview().validRows).toHaveLength(0);
    expect(component.preview().invalidRows).toHaveLength(1);
    expect(component.canImport()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Invalid amount.');
    expect(fixture.nativeElement.textContent).toContain('Some rows contain errors. Fix the file and try again.');
    expect(liassButtonWithText('Confirm import').disabled()).toBe(true);
  });

  it('submits canonical backend payload and shows duplicate counts', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    treasuryApi.importStatementLines.mockResolvedValue({
      imported: 1,
      skipped: 1,
      rejected: 0,
      errors: [],
      statementLines: []
    });
    await uploadCsv('date;libellé;montant;sens\n15/01/2026;Encaissement client;150 000;Entrée');

    await (fixture.componentInstance as unknown as { confirmImport: () => Promise<void> }).confirmImport();
    fixture.detectChanges();

    expect(treasuryApi.importStatementLines).toHaveBeenCalledWith('52100000', {
      year: '2026',
      lines: [
        expect.objectContaining({
          amount: 150000,
          currency: 'XOF',
          description: 'Encaissement client',
          direction: 'INFLOW',
          statementDate: '2026-01-15'
        })
      ]
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['treasury', 'org-test', 'statement-lines', '52100000']
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['treasury', 'org-test', 'summary']
    });
    expect(fixture.nativeElement.textContent).toContain('1 imported, 1 duplicate(s), 0 rejected');
  });

  async function uploadCsv(content: string): Promise<void> {
    const file = new File([content], 'statement.csv', { type: 'text/csv' });
    await (fixture.componentInstance as unknown as { handleFileSelected: (event: Event) => Promise<void> })
      .handleFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function liassButtonWithText(text: string): LiassButtonComponent {
    const button = fixture.debugElement
      .queryAll(By.directive(LiassButtonComponent))
      .find((debugElement) => debugElement.nativeElement.textContent.includes(text));

    if (!button) {
      throw new Error(`Button not found: ${text}`);
    }

    return button.componentInstance as LiassButtonComponent;
  }
});
