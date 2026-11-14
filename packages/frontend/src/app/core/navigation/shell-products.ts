import type { ProductCode } from '@liass-ohada/shared/shared';

const productIconClass = 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300';

export const shellProducts = [
  {
    code: 'ACCOUNTING',
    icon: 'calculate',
    iconClass: productIconClass,
    labelKey: 'SHELL.NAV.ACCOUNTING',
    route: '/dashboard',
  },
  {
    code: 'SALES',
    icon: 'receipt_long',
    iconClass: productIconClass,
    labelKey: 'SHELL.NAV.SALES',
    route: '/sales',
  },
  {
    code: 'RESTAURANTS',
    icon: 'restaurant',
    iconClass: productIconClass,
    labelKey: 'SHELL.NAV.RESTAURANTS',
    route: '/restaurants',
  },
] as const satisfies readonly {
  code: ProductCode;
  icon: string;
  iconClass: string;
  labelKey: string;
  route: string;
}[];

export type ShellProduct = (typeof shellProducts)[number];
