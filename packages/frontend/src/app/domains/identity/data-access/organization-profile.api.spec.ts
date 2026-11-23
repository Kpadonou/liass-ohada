import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { OrganizationProfileApi } from './organization-profile.api';
import { AuthStore } from './auth.store';
let org = 'org';
let api: OrganizationProfileApi; let http: HttpTestingController;
const contact={email:'',phone:'',address:'',city:'',postalCode:''};
beforeEach(()=>{ org='org'; TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:AuthStore,useValue:{effectiveOrgId:()=>org,currentUserId:()=> 'owner',contextRevision:()=>1}}]}); api=TestBed.inject(OrganizationProfileApi);http=TestBed.inject(HttpTestingController); });
afterEach(()=>http.verify());
it('rejects stale organization context without a request',async()=>{
 const context=api.context();org='other';await expect(api.read(context)).rejects.toThrow('WORKSPACE_CHANGED');http.expectNone(()=>true);
});
it('validates editable fields before HTTP',async()=>{
 await expect(api.update(api.context(),{expectedVersion:0,contact:{...contact,email:'bad'}})).rejects.toThrow();http.expectNone(()=>true);
});
it('rejects a response after tenant changes',async()=>{
 const promise=api.read(api.context());const req=http.expectOne(r=>r.url.endsWith('/me/organization/profile'));org='other';req.flush({data:{}});await expect(promise).rejects.toThrow('WORKSPACE_CHANGED');
});
it('sends one normalized organization-attested legal address update',async()=>{
 const promise=api.update(api.context(),{legalAddress:{expectedSelectionVersion:7,address:{lines:['Real street'],city:'Cotonou'},attested:true}});
 const req=http.expectOne(r=>r.url.endsWith('/me/organization/profile'));
 expect(req.request.method).toBe('PUT');
 expect(req.request.body).toEqual({legalAddress:{expectedSelectionVersion:7,address:{lines:['Real street'],city:'Cotonou'},attested:true}});
 const organization={orgId:'org',name:'Company',country:'BJ',workspaceType:'COMPANY',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
 req.flush({data:{organization,contact,version:0,canManage:true,legalIdentity:{version:'2',name:'Company',ifu:'123',address:'Real street, Cotonou',addressTrust:'ORGANIZATION_ATTESTED',missingEvidence:[],selectionVersion:8}}});
 await expect(promise).resolves.toMatchObject({organization:{orgId:'org'},legalIdentity:{selectionVersion:8,addressTrust:'ORGANIZATION_ATTESTED'}});
});
