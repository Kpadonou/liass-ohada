import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { OrganizationLegalIdentityService as Service } from '@/lambda/shared/services/organization-legal-identity-service';
import { OrganizationFiscalRepository as Access } from '@/lambda/shared/repositories/organization-fiscal-repository';
import { dynamoClient } from '@/lambda/shared/dynamo-client';
import { KeyFactory as K } from '@/lambda/shared/key-builder';
import { artifact, legal, id } from '../issuance-authority/fixtures';
const rows = new Map<string, Record<string, unknown>>();
const key = (v: Record<string, unknown>) => `${v.PK}/${v.SK}`;
const input = { expectedSelectionVersion: 1, address: { lines: ['Genuine address supplied by owner'], city: 'Cotonou' }, attested: true };
function reviewedSeller() {
  const base = legal('org');
  const {identityDigest: _digest, acceptanceReference: _acceptance,
    acceptanceVersion: _acceptanceVersion, evidenceArtifacts: _artifacts, ...identity} = base;
  const value = {...identity, seller:{name:'Synthetic seller',country:'BJ',
    identifiers:[{scheme:'IFU',issuingCountry:'BJ',value:'0202113816157'}]},
    factStates:['country','identifiers.0.issuingCountry','identifiers.0.scheme','identifiers.0.value','name']
      .map(fieldPath=>({fieldPath,state:'VERIFIED' as const,evidenceReference:'acceptance'}))};
  const proof=artifact(id,'1',value);
  const acceptance=artifact('acceptance','1',{orgId:'org',identityReference:id,identityVersion:'1',
    identityDigest:proof.digest,decision:'ACCEPTED',reviewedByUserId:'reviewer',selectionBaseVersion:0});
  return {...value,identityDigest:proof.digest,acceptanceReference:'acceptance',acceptanceVersion:'1',
    evidenceArtifacts:[proof,acceptance]};
}
beforeEach(() => {
  rows.clear();
  const revision = { ...reviewedSeller(), PK: K.orgKey('org'), SK: K.organizationLegalIdentityRevisionSK(id),
    revisionId: id, recordVersion: 1, entityType: 'ORGANIZATION_LEGAL_IDENTITY_REVISION' };
  rows.set(key(revision), revision);
  const current = { PK: K.orgKey('org'), SK: K.organizationLegalIdentityCurrentSK(), orgId: 'org',
    entityType: 'ORGANIZATION_LEGAL_IDENTITY_CURRENT', version: 1, status: 'ACTIVE', selectedRevisionId: id,
    identityDigest: revision.identityDigest };
  rows.set(key(current), current);
  jest.spyOn(Access, 'authorize').mockImplementation(async (org, actor) => {
    if (org !== 'org' || actor !== 'owner') throw Error('forbidden');
    return {canManage:true};
  });
  jest.spyOn(dynamoClient, 'send').mockImplementation((async (c: unknown) => {
    if (c instanceof GetItemCommand) {
      const value = rows.get(key(unmarshall(c.input.Key!)));
      return value ? {Item:marshall(value)} : {};
    }
    if (c instanceof TransactWriteItemsCommand) {
      const puts = c.input.TransactItems!.filter(i => i.Put).map(i => i.Put!);
      const pointer = puts.find(p => p.ExpressionAttributeValues)!;
      const expected = unmarshall(pointer.ExpressionAttributeValues!);
      if (rows.get(key(unmarshall(pointer.Item!)))?.version !== expected[':version'])
        throw Object.assign(Error('conflict'), {name:'TransactionCanceledException'});
      for (const p of puts) { const row = unmarshall(p.Item!); rows.set(key(row),row); }
    }
    return {};
  }) as never);
});
afterEach(() => jest.restoreAllMocks());
test('save and reload selects immutable attested address, preserves verified facts and old history', async () => {
  const before = JSON.stringify([...rows]);
  const selected = await Service.saveLegalAddress('org','owner',input);
  expect(selected.selectionVersion).toBe(2);
  expect(selected.revision.seller).toMatchObject({address:input.address});
  expect(selected.revision.factStates).toContainEqual({fieldPath:'name',state:'VERIFIED',evidenceReference:'acceptance'});
  expect(selected.revision.factStates).toContainEqual({fieldPath:'address.lines.0',state:'ORGANIZATION_ATTESTED'});
  expect(selected.revision.attestation).toMatchObject({actorUserId:'owner',orgId:'org',changedValues:{address:input.address}});
  expect((selected.revision.seller as any).address.postalCode).toBeUndefined();
  for (const [k,v] of JSON.parse(before)) if (v.entityType.endsWith('REVISION')) expect(rows.get(k)).toEqual(v);
  expect((await Service.readSelectedIdentity('org')).revision).toEqual(selected.revision);
  expect([...rows.values()].filter(r => r.entityType === 'ORGANIZATION_LEGAL_IDENTITY_SELECTION')).toHaveLength(1);
  const issuance = await Service.readSellerIssuanceAuthority('org');
  expect(issuance.sellerAuthority.factStates).toContainEqual({fieldPath:'address.lines.0',state:'ORGANIZATION_ATTESTED'});
  expect(issuance.sellerAuthority.factStates).toContainEqual({fieldPath:'identifiers.0.value',state:'VERIFIED',evidenceReference:'acceptance'});
  expect((await Service.readFiscalTaxpayerAuthority('org')).ifu).toBe('0202113816157');
  const second = await Service.saveLegalAddress('org','owner',{...input,expectedSelectionVersion:2});
  expect(second.selectionVersion).toBe(3);
  expect(second.revision.factStates).toContainEqual({fieldPath:'address.lines.0',state:'ORGANIZATION_ATTESTED'});
});
test('rejects tampered attestation and cannot upgrade declared address facts to verified',async()=>{
  const selected=await Service.saveLegalAddress('org','owner',input);
  const revision=rows.get(`${K.orgKey('org')}/${K.organizationLegalIdentityRevisionSK(selected.revision.revisionId as string)}`)!;
  revision.factStates=(revision.factStates as Array<Record<string,unknown>>).map(f=>f.fieldPath==='address.lines.0'
    ? {...f,state:'VERIFIED',evidenceReference:'acceptance'}:f);
  await expect(Service.readSellerIssuanceAuthority('org')).rejects.toThrow();
});
test('concurrent updates have one winner and preserve one selection history', async () => {
  const result = await Promise.allSettled([Service.saveLegalAddress('org','owner',input),Service.saveLegalAddress('org','owner',input)]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect([...rows.values()].filter(r => r.entityType === 'ORGANIZATION_LEGAL_IDENTITY_SELECTION')).toHaveLength(1);
});
test.each([['org','member'],['other','owner']])('denies unauthorized and cross tenant writes',async(org,actor)=>{
  const before = JSON.stringify([...rows]);
  await expect(Service.saveLegalAddress(org,actor,input)).rejects.toThrow('forbidden');
  expect(JSON.stringify([...rows])).toBe(before);
});
test('requires explicit attestation and never invents a missing address',async()=>{
  await expect(Service.saveLegalAddress('org','owner',{...input,attested:false})).rejects.toThrow();
  await expect(Service.saveLegalAddress('org','owner',{...input,address:{lines:[]}})).rejects.toThrow();
});
test('real membership authorization requires direct active COMPANY OWNER and guards transaction',async()=>{
  jest.mocked(Access.authorize).mockRestore();
  const member = {PK:K.orgKey('org'),SK:K.orgUserAccessSK('owner'),entityType:'USER_ORG_ACCESS',
    orgId:'org',userId:'owner',status:'ACTIVE',workspaceType:'COMPANY',accessSource:'DIRECT',role:'OWNER'};
  rows.set(key(member), member);
  await Service.saveLegalAddress('org','owner',input);
  const command = jest.mocked(dynamoClient.send).mock.calls.find(([c]) => c instanceof TransactWriteItemsCommand)![0] as TransactWriteItemsCommand;
  expect(command.input.TransactItems![0].ConditionCheck?.ConditionExpression).toContain('#role = :owner');
  rows.set(key(member), {...member,role:'MEMBER'});
  await expect(Service.saveLegalAddress('org','owner',{...input,expectedSelectionVersion:2})).rejects.toMatchObject({statusCode:403});
  await expect(Service.saveLegalAddress('other','owner',input)).rejects.toMatchObject({statusCode:403});
});
