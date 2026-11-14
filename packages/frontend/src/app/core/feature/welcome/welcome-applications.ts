import { shellProducts, type ShellProduct } from '../../navigation/shell-products';

export type WelcomeApplication = Omit<ShellProduct, 'labelKey' | 'route'> & {
  labelKey: string;
  route: string;
  descriptionKey: string;
};

export const welcomeApplicationCatalog: readonly WelcomeApplication[] = shellProducts.map(
  (product) => ({
    ...product,
    descriptionKey: `WELCOME.APPLICATION.${product.code}.DESCRIPTION`,
  }),
);
