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
