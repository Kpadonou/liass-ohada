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
 const updated={...profile,legalIdentity:{...legalIdentity,version:'2',selectionVersion:8,address:'Owner supplied address',addressTrust:'ORGANIZATION_ATTESTED' as const}};
 api.update.mockResolvedValue(updated);
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 const p=f.componentInstance;p.legalForm.patchValue({line1:'  Owner supplied address  ',city:'  Cotonou  ',attested:true});f.detectChanges();
 api.read.mockResolvedValue(updated);
 const legalForm=f.nativeElement.querySelectorAll('form')[1] as HTMLFormElement;
 const saveButton=legalForm.querySelector('liass-button button') as HTMLButtonElement;
 expect(saveButton.type).toBe('submit');
 legalForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 legalForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(p.legalMutation.isSuccess()).toBe(true));
 expect(api.update).toHaveBeenCalledTimes(1);
 expect(api.update.mock.calls[0][1]).toEqual({legalAddress:{expectedSelectionVersion:7,address:{lines:['Owner supplied address'],city:'Cotonou'},attested:true}});
 expect(p.query.data()?.legalIdentity?.selectionVersion).toBe(8);
 expect(p.legalForm.controls.attested.value).toBe(false);
});
it('shows validation feedback instead of silently ignoring an invalid legal save',async()=>{
 const legalIdentity={version:'1',name:'Company',ifu:null,address:null,missingEvidence:['address'],selectionVersion:7};
 api.read.mockResolvedValue({...profile,legalIdentity});
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 const p=f.componentInstance;p.legalForm.patchValue({line1:'Address without attestation'});f.detectChanges();
 const legalForm=f.nativeElement.querySelectorAll('form')[1] as HTMLFormElement;
 expect((legalForm.querySelector('liass-button button') as HTMLButtonElement).type).toBe('submit');
 legalForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.detectChanges();
 expect(api.update).not.toHaveBeenCalled();expect(p.legalValidationVisible()).toBe(true);
 expect(legalForm.querySelector('[role="alert"]')).not.toBeNull();
});
it('does not present organization-attested address as missing verified evidence',async()=>{
 api.read.mockResolvedValue({...profile,legalIdentity:{version:'2',name:'Company',ifu:'123',address:'Real street, Cotonou',addressTrust:'ORGANIZATION_ATTESTED',missingEvidence:['address'],selectionVersion:8}});
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 expect(f.nativeElement.textContent).not.toContain('ORG_PROFILE.MISSING_address');
 expect(f.componentInstance.visibleMissingEvidence(f.componentInstance.query.data()!.legalIdentity!)).toEqual([]);
});
it.each([{status:400,key:'ORG_PROFILE.LEGAL_VALIDATION'},{status:403,key:'ORG_PROFILE.FORBIDDEN'},
 {status:409,key:'ORG_PROFILE.CONFLICT'},{status:422,key:'ORG_PROFILE.LEGAL_VALIDATION'}])('preserves legal input and explains HTTP $status',async({status,key})=>{
 api.read.mockResolvedValue({...profile,legalIdentity:{version:'1',name:'Company',ifu:null,address:null,missingEvidence:['address'],selectionVersion:1}});
 api.update.mockRejectedValue(new HttpErrorResponse({status}));
 const f=TestBed.createComponent(OrganizationProfilePage);f.detectChanges();await vi.waitFor(()=>expect(f.componentInstance.query.isSuccess()).toBe(true));f.detectChanges();
 const p=f.componentInstance;p.legalForm.patchValue({line1:'Owner supplied address',attested:true});p.legalForm.markAsDirty();p.saveLegal();
 await vi.waitFor(()=>expect(p.legalMutation.isError()).toBe(true));
 expect(p.legalForm.controls.line1.value).toBe('Owner supplied address');
 expect(p.legalErrorKey()).toBe(key);
});
