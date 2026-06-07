import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';

import { CabinetDossierNewPage } from './cabinet-dossier-new.page';

const translations = {
  en: {
    IDENTITY: {
      CABINET_DOSSIERS: {
        DIALOG: {
          REDIRECTING: 'Opening the creation form...'
        }
      }
    }
  }
};

describe('CabinetDossierNewPage', () => {
  let fixture: ComponentFixture<CabinetDossierNewPage>;
  let router: Router;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [
        CabinetDossierNewPage,
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

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('redirects the legacy new-dossier page to the dialog deep link', async () => {
    fixture = TestBed.createComponent(CabinetDossierNewPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/cabinet/dossiers'], {
      queryParams: { createDossier: '1' },
      replaceUrl: true
    });
    expect(fixture.nativeElement.textContent).toContain('Opening the creation form...');
  });
});
