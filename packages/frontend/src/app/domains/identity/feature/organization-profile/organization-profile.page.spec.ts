import { LegalIdentityApi } from '../../data-access/legal-identity.api';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { TranslocoTestingModule } from '@ngneat/transloco';
import { vi } from 'vitest';
import { OrganizationProfileApi } from '../../data-access/organization-profile.api';
import { OrganizationProfilePage } from './organization-profile.page';
const profile={organization:{orgId:'org',name:'Company',country:'BJ',workspaceType:'COMPANY',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},contact:{email:'',phone:'',address:'',city:'',postalCode:''},version:0,canManage:true,legalIdentity:null};
const api={context:()=>['org','owner',1],read:vi.fn(),update:vi.fn()};
beforeEach(()=>{ api.read.mockReset().mockResolvedValue(profile);api.update.mockReset().mockImplementation(async(_c,body)=>({...profile,contact:body.contact,version:1}));TestBed.configureTestingModule({imports:[OrganizationProfilePage,TranslocoTestingModule.forRoot({langs:{en:{}},translocoConfig:{defaultLang:'en',availableLangs:['en']}})],providers:[{provide:LegalIdentityApi,useValue:{context:()=>['owner','org',1],list:async()=>({items:[],nextCursor:null}),auth:{currentUserId:()=> 'owner'}}},provideTanStackQuery(new QueryClient({defaultOptions:{queries:{retry:false}}})),{provide:OrganizationProfileApi,useValue:api}]}); });
it('loads actual contact values and saves only editable contact with expected version',async()=>{
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 f.componentInstance.form.controls.phone.setValue('123');f.componentInstance.save();await vi.waitFor(()=>expect(api.update).toHaveBeenCalled());
 expect(api.update.mock.calls[0][1]).toEqual({expectedVersion:0,contact:{...profile.contact,phone:'123'}});
 await vi.waitFor(()=>expect(f.componentInstance.query.data()?.version).toBe(1));
});
it('read-only member cannot save',async()=>{
 api.read.mockResolvedValue({...profile,canManage:false});const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();f.componentInstance.save();expect(api.update).not.toHaveBeenCalled();expect(f.componentInstance.form.disabled).toBe(true);
});
