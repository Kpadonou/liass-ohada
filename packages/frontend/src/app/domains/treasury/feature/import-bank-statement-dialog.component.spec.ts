import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

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
        DIALOG: { TITLE: 'Import bank statement' },
        ERRORS: { PARSE_FAILED: 'Parse failed.', SUBMIT_FAILED: 'Import failed.' },
        FILE: { CHOOSE: 'Choose file', HELP: 'Excel or CSV.', PARSING: 'Reading file...', TITLE: 'Statement file' },
        PREVIEW: {
          BLOCKED: 'Fix invalid rows.',
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
    expect(fixture.nativeElement.textContent).toContain('Customer receipt');
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
});
