import { CanMatchFn } from '@angular/router';

import { isPublicSiteHost } from './public-site.config';

export const publicLandingHostGuard: CanMatchFn = () => isPublicSiteHost();
