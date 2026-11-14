import type { ProductCode } from '@liass-ohada/shared/shared';

export const shellProducts = [
  {
    code: 'ACCOUNTING',
    icon: 'account_balance',
    labelKey: 'SHELL.NAV.ACCOUNTING',
    route: '/dashboard',
  },
  { code: 'SALES', icon: 'storefront', labelKey: 'SHELL.NAV.SALES', route: '/sales' },
  {
    code: 'RESTAURANTS',
    icon: 'restaurant',
    labelKey: 'SHELL.NAV.RESTAURANTS',
    route: '/restaurants',
  },
] as const satisfies readonly {
  code: ProductCode;
  icon: string;
  labelKey: string;
  route: string;
}[];

export type ShellProduct = (typeof shellProducts)[number];
