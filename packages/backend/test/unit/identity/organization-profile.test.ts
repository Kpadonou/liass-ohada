import { legal } from '../issuance-authority/fixtures';
import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { OrganizationProfileService as Service } from '@/lambda/shared/services/organization-profile-service';
import { OrganizationService } from '@/lambda/shared/services/organization-service';
import { OrganizationLegalIdentityService } from '@/lambda/shared/services/organization-legal-identity-service';
import { OrganizationFiscalRepository as Access } from '@/lambda/shared/repositories/organization-fiscal-repository';
import { dynamoClient } from '@/lambda/shared/dynamo-client';
import { AppError } from '@/lambda/shared/app-error';
const contact = {email:'a@example.com',phone:'123',address:'Contact only',city:'Cotonou',postalCode:''};
beforeEach(() => {
 jest.spyOn(OrganizationLegalIdentityService,'readSelectedIdentity').mockResolvedValue({revision:{},selectionVersion:1,check:{}});
 jest.spyOn(Access,'authorize').mockResolvedValue({canManage:true});
 jest.spyOn(Access,'membershipCheck').mockReturnValue({ConditionCheck:{TableName:'table',Key:{},ConditionExpression:'owner',ExpressionAttributeNames:{'#status':'status','#role':'role'},ExpressionAttributeValues:{}}});
 jest.spyOn(OrganizationService,'getOrganization').mockResolvedValue({orgId:'org',name:'Company',country:'BJ',workspaceType:'COMPANY',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'});
 jest.spyOn(OrganizationLegalIdentityService,'readSellerIssuanceAuthority').mockRejectedValue(new AppError(409,'AUTHORITY_UNAVAILABLE'));
 jest.spyOn(dynamoClient,'send').mockImplementation((async (c: unknown) => c instanceof GetItemCommand ? {Item:marshall({contact,contactVersion:1})} : {}) as never);
});
afterEach(()=>jest.restoreAllMocks());
test('read preserves contact and explicitly represents missing selected identity',async()=>{
 expect(await Service.read('org','actor')).toMatchObject({contact,version:1,legalIdentity:null,canManage:true});
});
test('save updates only contact with version and transactional owner guard',async()=>{
 await Service.update('org','actor',{contact,expectedVersion:1});
 const call=jest.mocked(dynamoClient.send).mock.calls.find(([c])=>c instanceof TransactWriteItemsCommand)![0] as TransactWriteItemsCommand;
 expect(call.input.TransactItems).toHaveLength(2);
 const update=call.input.TransactItems![1].Update!;
 expect(update.UpdateExpression).toBe('SET contact = :contact, contactVersion = :next');
 expect(update.ConditionExpression).toContain('contactVersion = :version');
 expect(update.Key?.PK.S).toBe('ORG#org');
});
test('invalid legal field injection and invalid email are rejected before write',async()=>{
 await expect(Service.update('org','actor',{contact:{...contact,legalName:'forged'},expectedVersion:1})).rejects.toThrow();
 await expect(Service.update('org','actor',{contact:{...contact,email:'bad'},expectedVersion:1})).rejects.toThrow();
 expect(jest.mocked(dynamoClient.send).mock.calls).toHaveLength(0);
});
test('unauthorized actor cannot write',async()=>{
 jest.mocked(Access.authorize).mockRejectedValue(new AppError(403,'PLATFORM_FISCAL_FORBIDDEN'));
 await expect(Service.update('org','actor',{contact,expectedVersion:1})).rejects.toMatchObject({statusCode:403});
 expect(dynamoClient.send).not.toHaveBeenCalled();
});
test('stale concurrent update fails without overwriting',async()=>{
 jest.mocked(dynamoClient.send).mockRejectedValue(Object.assign(new Error(),{name:'TransactionCanceledException'}) as never);
 await expect(Service.update('org','actor',{contact,expectedVersion:1})).rejects.toMatchObject({statusCode:409});
});
test('selected identity exposes version and missing legal address without contact fallback',async()=>{
 const {evidenceArtifacts,...authority}=legal('org');
 jest.mocked(OrganizationLegalIdentityService.readSellerIssuanceAuthority).mockResolvedValue({sellerAuthority:authority,selectionVersion:1,check:{}} as never);
 expect((await Service.read('org','actor')).legalIdentity).toMatchObject({version:'1',name:'Synthetic seller',ifu:null,address:null,missingEvidence:['ifu','address'],selectionVersion:1,authority});
});
