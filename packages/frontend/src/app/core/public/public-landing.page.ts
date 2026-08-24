import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { Meta, Title } from '@angular/platform-browser';
import { TranslocoModule, TranslocoService } from '@ngneat/transloco';
import { combineLatest } from 'rxjs';

import { LanguageSelectorComponent } from '../i18n/language-selector/language-selector.component';
import { LiassLogoComponent } from '../../shared/ui/liass-logo/liass-logo.component';
import { PublicProductPreviewComponent } from './public-product-preview.component';
import { PublicRevealDirective } from './public-reveal.directive';
import { PublicScrollStateDirective } from './public-scroll-state.directive';
import { publicSiteConfig } from './public-site.config';

type PublicItem = {
  icon: string;
  titleKey: string;
  descriptionKey: string;
};

type PublicDomainStatus = 'AVAILABLE' | 'IN_DEVELOPMENT' | 'COMING';

type PublicCapability = PublicItem & {
  id: string;
  status: PublicDomainStatus;
};

type PublicDomainCard = PublicItem & {
  id: string;
  status: PublicDomainStatus;
};

type PublicFeatureGroup = {
  icon: string;
  titleKey: string;
  itemKeys: string[];
};

@Component({
  selector: 'liass-public-landing',
  imports: [
    LanguageSelectorComponent,
    LiassLogoComponent,
    MatExpansionModule,
    MatIconModule,
    MatSidenavModule,
    PublicProductPreviewComponent,
    PublicRevealDirective,
    PublicScrollStateDirective,
    TranslocoModule
  ],
  templateUrl: './public-landing.page.html',
  styleUrl: './public-landing.page.css'
})
export class PublicLandingPage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  protected readonly mobileNav = viewChild(MatSidenav);
  protected readonly config = publicSiteConfig;
  protected readonly headerScrolled = signal(false);

  protected readonly navigation = [
    { href: '#product', labelKey: 'PUBLIC.NAV.PRODUCT' },
    { href: '#features', labelKey: 'PUBLIC.NAV.FEATURES' },
    { href: '#companies', labelKey: 'PUBLIC.NAV.COMPANIES' },
    { href: '#firms', labelKey: 'PUBLIC.NAV.FIRMS' },
    { href: '#facturation', labelKey: 'PUBLIC.NAV.FACTURATION' },
    { href: '#early-access', labelKey: 'PUBLIC.NAV.EARLY_ACCESS' }
  ];

  protected readonly problems: PublicItem[] = [
    {
      icon: 'grid_view',
      titleKey: 'PUBLIC.PROBLEMS.ITEMS.DISPERSED.TITLE',
      descriptionKey: 'PUBLIC.PROBLEMS.ITEMS.DISPERSED.DESCRIPTION'
    },
    {
      icon: 'tune',
      titleKey: 'PUBLIC.PROBLEMS.ITEMS.GENERIC.TITLE',
      descriptionKey: 'PUBLIC.PROBLEMS.ITEMS.GENERIC.DESCRIPTION'
    },
    {
      icon: 'visibility_off',
      titleKey: 'PUBLIC.PROBLEMS.ITEMS.VISIBILITY.TITLE',
      descriptionKey: 'PUBLIC.PROBLEMS.ITEMS.VISIBILITY.DESCRIPTION'
    }
  ];

  protected readonly companyFeatures = [
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.ACCOUNTS',
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.ENTRIES',
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.THIRD_PARTIES',
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.TREASURY',
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.RECONCILIATION',
    'PUBLIC.WORKSPACES.COMPANY.FEATURES.REPORTING'
  ];

  protected readonly firmFeatures = [
    'PUBLIC.WORKSPACES.FIRM.FEATURES.DOSSIERS',
    'PUBLIC.WORKSPACES.FIRM.FEATURES.TEAM',
    'PUBLIC.WORKSPACES.FIRM.FEATURES.WORK',
    'PUBLIC.WORKSPACES.FIRM.FEATURES.DEADLINES',
    'PUBLIC.WORKSPACES.FIRM.FEATURES.DASHBOARD',
    'PUBLIC.WORKSPACES.FIRM.FEATURES.ACCOUNTING'
  ];

  protected readonly accountingCapabilities: PublicCapability[] = [
    {
      id: 'general-accounting',
      icon: 'account_balance',
      status: 'AVAILABLE',
      titleKey: 'PUBLIC.FEATURES.CAPABILITIES.ACCOUNTING.TITLE',
      descriptionKey: 'PUBLIC.FEATURES.CAPABILITIES.ACCOUNTING.DESCRIPTION'
    },
    {
      id: 'treasury',
      icon: 'payments',
      status: 'AVAILABLE',
      titleKey: 'PUBLIC.FEATURES.CAPABILITIES.TREASURY.TITLE',
      descriptionKey: 'PUBLIC.FEATURES.CAPABILITIES.TREASURY.DESCRIPTION'
    },
    {
      id: 'project-accounting',
      icon: 'folder_managed',
      status: 'IN_DEVELOPMENT',
      titleKey: 'PUBLIC.FEATURES.CAPABILITIES.PROJECT_ACCOUNTING.TITLE',
      descriptionKey: 'PUBLIC.FEATURES.CAPABILITIES.PROJECT_ACCOUNTING.DESCRIPTION'
    },
    {
      id: 'reporting-closing',
      icon: 'query_stats',
      status: 'AVAILABLE',
      titleKey: 'PUBLIC.FEATURES.CAPABILITIES.REPORTING.TITLE',
      descriptionKey: 'PUBLIC.FEATURES.CAPABILITIES.REPORTING.DESCRIPTION'
    }
  ];

  protected readonly accountingFirmGroup: PublicFeatureGroup = {
    icon: 'business_center',
    titleKey: 'PUBLIC.FEATURES.FIRM.TITLE',
    itemKeys: [
      'PUBLIC.FEATURES.FIRM.DOSSIERS',
      'PUBLIC.FEATURES.FIRM.TEAM',
      'PUBLIC.FEATURES.FIRM.WORK',
      'PUBLIC.FEATURES.FIRM.DEADLINES',
      'PUBLIC.FEATURES.FIRM.DASHBOARD'
    ]
  };

  protected readonly productViews: PublicItem[] = [
    {
      icon: 'space_dashboard',
      titleKey: 'PUBLIC.TOUR.ITEMS.CABINET.TITLE',
      descriptionKey: 'PUBLIC.TOUR.ITEMS.CABINET.DESCRIPTION'
    },
    {
      icon: 'menu_book',
      titleKey: 'PUBLIC.TOUR.ITEMS.ACCOUNTING.TITLE',
      descriptionKey: 'PUBLIC.TOUR.ITEMS.ACCOUNTING.DESCRIPTION'
    },
    {
      icon: 'account_balance_wallet',
      titleKey: 'PUBLIC.TOUR.ITEMS.TREASURY.TITLE',
      descriptionKey: 'PUBLIC.TOUR.ITEMS.TREASURY.DESCRIPTION'
    }
  ];

  protected readonly ohadaPillars: PublicItem[] = [
    {
      icon: 'library_books',
      titleKey: 'PUBLIC.OHADA.PILLARS.SYSCOHADA.TITLE',
      descriptionKey: 'PUBLIC.OHADA.PILLARS.SYSCOHADA.DESCRIPTION'
    },
    {
      icon: 'volunteer_activism',
      titleKey: 'PUBLIC.OHADA.PILLARS.SYCEBNL.TITLE',
      descriptionKey: 'PUBLIC.OHADA.PILLARS.SYCEBNL.DESCRIPTION'
    },
    {
      icon: 'public',
      titleKey: 'PUBLIC.OHADA.PILLARS.STATES.TITLE',
      descriptionKey: 'PUBLIC.OHADA.PILLARS.STATES.DESCRIPTION'
    },
    {
      icon: 'translate',
      titleKey: 'PUBLIC.OHADA.PILLARS.LANGUAGES.TITLE',
      descriptionKey: 'PUBLIC.OHADA.PILLARS.LANGUAGES.DESCRIPTION'
    },
    {
      icon: 'hub',
      titleKey: 'PUBLIC.OHADA.PILLARS.MULTI_ORG.TITLE',
      descriptionKey: 'PUBLIC.OHADA.PILLARS.MULTI_ORG.DESCRIPTION'
    }
  ];

  protected readonly facturationCore = [
    'PUBLIC.FACTURATION.CORE.INVOICES',
    'PUBLIC.FACTURATION.CORE.CUSTOMERS',
    'PUBLIC.FACTURATION.CORE.PRODUCTS',
    'PUBLIC.FACTURATION.CORE.PAYMENTS',
    'PUBLIC.FACTURATION.CORE.HISTORY',
    'PUBLIC.FACTURATION.CORE.PDF'
  ];

  protected readonly accessSteps: PublicItem[] = [
    {
      icon: 'person_add',
      titleKey: 'PUBLIC.ACCESS.STEPS.ACCOUNT.TITLE',
      descriptionKey: 'PUBLIC.ACCESS.STEPS.ACCOUNT.DESCRIPTION'
    },
    {
      icon: 'domain',
      titleKey: 'PUBLIC.ACCESS.STEPS.WORKSPACE.TITLE',
      descriptionKey: 'PUBLIC.ACCESS.STEPS.WORKSPACE.DESCRIPTION'
    },
    {
      icon: 'tune',
      titleKey: 'PUBLIC.ACCESS.STEPS.CONFIGURE.TITLE',
      descriptionKey: 'PUBLIC.ACCESS.STEPS.CONFIGURE.DESCRIPTION'
    },
    {
      icon: 'rocket_launch',
      titleKey: 'PUBLIC.ACCESS.STEPS.START.TITLE',
      descriptionKey: 'PUBLIC.ACCESS.STEPS.START.DESCRIPTION'
    }
  ];

  protected readonly futureDomains: PublicDomainCard[] = [
    { id: 'sales-invoicing', icon: 'receipt_long', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.SALES.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.SALES.DESCRIPTION' },
    { id: 'purchasing-suppliers', icon: 'shopping_cart', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.PURCHASES.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.PURCHASES.DESCRIPTION' },
    { id: 'inventory', icon: 'inventory_2', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.INVENTORY.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.INVENTORY.DESCRIPTION' },
    { id: 'fixed-assets', icon: 'precision_manufacturing', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.FIXED_ASSETS.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.FIXED_ASSETS.DESCRIPTION' },
    { id: 'payroll-hr', icon: 'groups', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.PAYROLL.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.PAYROLL.DESCRIPTION' },
    { id: 'tax-declarations', icon: 'verified_user', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.TAX.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.TAX.DESCRIPTION' },
    { id: 'restaurants', icon: 'restaurant', status: 'COMING', titleKey: 'PUBLIC.ROADMAP.DOMAINS.RESTAURANTS.TITLE', descriptionKey: 'PUBLIC.ROADMAP.DOMAINS.RESTAURANTS.DESCRIPTION' }
  ];

  protected readonly securityItems = [
    'PUBLIC.SECURITY.ITEMS.AUTHENTICATION',
    'PUBLIC.SECURITY.ITEMS.ISOLATION',
    'PUBLIC.SECURITY.ITEMS.ROLES',
    'PUBLIC.SECURITY.ITEMS.TRACEABILITY',
    'PUBLIC.SECURITY.ITEMS.CLOUD'
  ];

  protected readonly faqs = Array.from({ length: 8 }, (_, index) => ({
    questionKey: `PUBLIC.FAQ.ITEMS.${index + 1}.QUESTION`,
    answerKey: `PUBLIC.FAQ.ITEMS.${index + 1}.ANSWER`
  }));

  constructor() {
    this.configureSeo();
  }

  protected closeMobileNavigation(): void {
    void this.mobileNav()?.close();
  }

  private configureSeo(): void {
    combineLatest([
      this.transloco.selectTranslate('PUBLIC.SEO.TITLE'),
      this.transloco.selectTranslate('PUBLIC.SEO.DESCRIPTION')
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([pageTitle, description]) => {
        this.title.setTitle(pageTitle);
        this.meta.updateTag({ name: 'description', content: description });
        this.meta.updateTag({ property: 'og:title', content: pageTitle });
        this.meta.updateTag({ property: 'og:description', content: description });
        this.meta.updateTag({ property: 'og:type', content: 'website' });
        this.meta.updateTag({ property: 'og:url', content: `${publicSiteConfig.publicBaseUrl}/` });
        this.meta.updateTag({ property: 'og:image', content: `${publicSiteConfig.publicBaseUrl}/assets/brand/logos/liass-horizontal-dark.png` });
        this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
      });

    this.transloco.langChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((language) => this.document.documentElement.setAttribute('lang', language));

    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.rel = 'canonical';
      this.document.head.appendChild(canonical);
    }
    canonical.href = `${publicSiteConfig.publicBaseUrl}/`;
  }
}
