import type { ProductCode } from '@liass-ohada/shared/shared';

/** Presentation metadata; ProductAccess and workspace permissions remain authoritative. */
export interface WelcomeApplication {
  code: ProductCode;
  icon: string;
  iconClass: string;
  titleKey: string;
  descriptionKey: string;
  openRoute: string;
  configureRoute: string;
  canConfigure: boolean;
}

export const welcomeApplicationCatalog = [
  {
    code: 'ACCOUNTING',
    icon: 'calculate',
    iconClass: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
    titleKey: 'WELCOME.APPLICATION.ACCOUNTING.TITLE',
    descriptionKey: 'WELCOME.APPLICATION.ACCOUNTING.DESCRIPTION',
    openRoute: '/dashboard',
    configureRoute: '/accounting/fiscal-years',
  },
  {
    code: 'SALES',
    icon: 'receipt_long',
    iconClass: 'bg-success-50 text-success-600 dark:bg-emerald-950/40 dark:text-emerald-300',
    titleKey: 'WELCOME.APPLICATION.SALES.TITLE',
    descriptionKey: 'WELCOME.APPLICATION.SALES.DESCRIPTION',
    openRoute: '/sales',
    configureRoute: '/settings/fiscality',
  },
  {
    code: 'RESTAURANTS',
    icon: 'restaurant',
    iconClass: 'bg-warning-50 text-warning-600 dark:bg-amber-950/40 dark:text-amber-300',
    titleKey: 'WELCOME.APPLICATION.RESTAURANTS.TITLE',
    descriptionKey: 'WELCOME.APPLICATION.RESTAURANTS.DESCRIPTION',
    openRoute: '/restaurants',
    configureRoute: '/restaurants/setup',
  },
] as const;
