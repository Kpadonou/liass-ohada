import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery,QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';
import { LegalReviewPage } from './legal-review.page';
import { LegalIdentityApi } from '../../data-access/legal-identity.api';
it('unauthorized Platform user has no review or activation controls',async()=>{const api={context:()=>['user','org',1],capability:vi.fn().mockResolvedValue({canReview:false}),selected:vi.fn()};TestBed.configureTestingModule({imports:[LegalReviewPage,TranslocoTestingModule.forRoot({langs:{en:{}},translocoConfig:{defaultLang:'en',availableLangs:['en']}})],providers:[provideTanStackQuery(new QueryClient({defaultOptions:{queries:{retry:false}}})),{provide:LegalIdentityApi,useValue:api}]});const f=TestBed.createComponent(LegalReviewPage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.capability.isSuccess()).toBe(true));f.detectChanges();f.componentInstance.organization.setValue('org');f.componentInstance.open();expect(f.componentInstance.org()).toBe('');expect(api.selected).not.toHaveBeenCalled();expect(f.nativeElement.querySelector('liass-legal-proposals')).toBeNull();});
