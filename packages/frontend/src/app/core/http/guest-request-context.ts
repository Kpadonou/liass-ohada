import { HttpContextToken } from '@angular/common/http';
/** Only the Restaurants Guest client sets this; exact URLs are checked independently. */
export const GUEST_CAPABILITY_REQUEST = new HttpContextToken<boolean>(() => false);
