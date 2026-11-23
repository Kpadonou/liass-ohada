import { LegalIdentityApi } from '../../data-access/legal-identity.api';
import { HttpErrorResponse } from '@angular/common/http';
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
it('requires attestation, sends selected version and refreshes canonical identity from save response',async()=>{
 const legalIdentity={version:'1',name:'Company',ifu:null,address:null,missingEvidence:['address'],selectionVersion:7};
 api.read.mockResolvedValue({...profile,legalIdentity});
 api.update.mockResolvedValue({...profile,legalIdentity:{...legalIdentity,version:'2',selectionVersion:8,address:'Owner supplied address',addressTrust:'ORGANIZATION_ATTESTED'}});
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 const p=f.componentInstance;p.legalForm.patchValue({line1:'Owner supplied address',city:'Cotonou'});p.saveLegal();expect(api.update).not.toHaveBeenCalled();
 p.legalForm.controls.attested.setValue(true);p.saveLegal();p.saveLegal();
 await vi.waitFor(()=>expect(p.legalMutation.isSuccess()).toBe(true));
 expect(api.update).toHaveBeenCalledTimes(1);
 expect(api.update.mock.calls[0][1]).toEqual({legalAddress:{expectedSelectionVersion:7,address:{lines:['Owner supplied address'],city:'Cotonou'},attested:true}});
 expect(p.query.data()?.legalIdentity?.selectionVersion).toBe(8);
 expect(p.legalForm.controls.attested.value).toBe(false);
});
it.each([403,409])('preserves legal input and explains HTTP %s',async(status)=>{
 api.read.mockResolvedValue({...profile,legalIdentity:{version:'1',name:'Company',ifu:null,address:null,missingEvidence:['address'],selectionVersion:1}});
 api.update.mockRejectedValue(new HttpErrorResponse({status}));
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 const p=f.componentInstance;p.legalForm.patchValue({line1:'Owner supplied address',attested:true});p.legalForm.markAsDirty();p.saveLegal();
 await vi.waitFor(()=>expect(p.legalMutation.isError()).toBe(true));
 expect(p.legalForm.controls.line1.value).toBe('Owner supplied address');
 expect(p.legalErrorKey()).toBe(status===409?'ORG_PROFILE.CONFLICT':'ORG_PROFILE.FORBIDDEN');
});
