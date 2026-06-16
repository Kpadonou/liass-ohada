import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';

import { AccountingOverviewPage } from './accounting-overview.page';

const translations = {
  en: {
    ACCOUNTING: {
      OVERVIEW: {
        CARDS: {
          CHART: {
            DESCRIPTION: 'Review the tenant chart of accounts.',
            STATUS: 'Ready',
            TITLE: 'Chart of accounts'
          },
          JOURNALS: {
            DESCRIPTION: 'Open the journal register.',
            STATUS: 'Ready',
            TITLE: 'Journals'
          },
          LABEL: 'Accounting entry points',
          OPEN: 'Open'
        },
        EYEBROW: 'Accounting',
        LOT: {
          DESCRIPTION: 'Lot 1 starts with stable accounting entry points.',
          TITLE: 'Lot 1 entry point'
        },
        SUBTITLE: 'Start with the accounting setup surfaces.',
        TITLE: 'Accounting'
      }
    }
  }
};

describe('AccountingOverviewPage', () => {
  let fixture: ComponentFixture<AccountingOverviewPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountingOverviewPage,
        TranslocoTestingModule.forRoot({
          langs: translations,
          preloadLangs: true,
          translocoConfig: {
            availableLangs: ['en'],
            defaultLang: 'en'
          }
        })
      ],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AccountingOverviewPage);
    fixture.detectChanges();
  });

  it('renders lot 1 accounting cards that link to chart of accounts and journals', () => {
    const text = fixture.nativeElement.textContent;
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')).map((link) =>
      (link as HTMLAnchorElement).getAttribute('href')
    );

    expect(text).toContain('Accounting');
    expect(text).toContain('Chart of accounts');
    expect(text).toContain('Journals');
    expect(links).toContain('/accounting/accounts');
    expect(links).toContain('/accounting/journals');
  });
});
