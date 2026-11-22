import { z } from 'zod';
import { GetItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LegalSellerAuthoritySchema, AuthorityArtifactSchema } from '@liass-ohada/shared/shared';
import { config, dynamoClient } from '../dynamo-client';
import { KeyFactory as K } from '../key-builder';
import { AppError } from '../app-error';
import { assertArtifact, admission, canonical } from '../authority/integrity';
import { OrganizationFiscalRepository as Access } from '../repositories/organization-fiscal-repository';
import { requireLegalReviewer } from '../authorization/legal-review';
import type { PlatformPrincipal } from '../authorization/platform-admin';
import { OrganizationLegalIdentityService as Identity } from './organization-legal-identity-service';
export const LegalProposalRequestSchema = z.object({proposalId:z.string().uuid(), seller:LegalSellerAuthoritySchema.shape.seller,
  legalEntityReference:z.string().min(1).max(200), evidenceArtifacts:z.array(AuthorityArtifactSchema).min(1).max(60)}).strict();
export const LegalReviewRequestSchema = z.discriminatedUnion('decision',[
  z.object({decision:z.literal('REJECTED'),reason:z.string().trim().min(1).max(1000)}).strict(),
  z.object({decision:z.literal('ACCEPTED'),revision:LegalSellerAuthoritySchema.extend({evidenceArtifacts:z.array(AuthorityArtifactSchema).min(2).max(64)}).strict()}).strict(),
]);
const key = (orgId:string,sk:string)=>({PK:K.orgKey(orgId),SK:sk});
const table=()=>config.TABLE_NAME;
const conflict=()=>new AppError(409,'AUTHORITY_REVISION_CONFLICT');
async function get(orgId:string,sk:string) {
 const r=await dynamoClient.send(new GetItemCommand({TableName:table(),Key:marshall(key(orgId,sk)),ConsistentRead:true}));
 const row=r.Item?unmarshall(r.Item):undefined;
 if(row && row.orgId!==orgId) throw new AppError(403,'AUTHORITY_TENANT_MISMATCH');
 return row;
}
export class LegalIdentityProposalService {
 static async context(orgId:string,principal:PlatformPrincipal) {
  await requireLegalReviewer(principal);
  try {const selected=await Identity.readSellerIssuanceAuthority(orgId);return {authority:selected.sellerAuthority,selectionVersion:selected.selectionVersion};}
  catch(e){if(e instanceof AppError && e.messageCode==='AUTHORITY_UNAVAILABLE')return {authority:null,selectionVersion:await Identity.readSelectionVersion(orgId)};throw e;}
 }
 static async list(orgId:string,actor:string,cursor?:string,principal?:PlatformPrincipal) {
  if(principal)await requireLegalReviewer(principal);else await Access.authorize(orgId,actor,false,false);
  let start: {PK:string;SK:string}|undefined;
  if(cursor){try {z.string().max(4096).parse(cursor);start=z.object({PK:z.literal(K.orgKey(orgId)),SK:z.string().startsWith(K.organizationLegalProposalSK(''))}).strict().parse(JSON.parse(Buffer.from(cursor,'base64url').toString()));}catch{throw new AppError(400,'ERROR_INVALID_INPUT');}}
  const result=await dynamoClient.send(new QueryCommand({TableName:table(),KeyConditionExpression:'PK = :pk AND begins_with(SK, :prefix)',ExpressionAttributeValues:marshall({':pk':K.orgKey(orgId),':prefix':K.organizationLegalProposalSK('')}),ConsistentRead:true,Limit:20,...(start?{ExclusiveStartKey:marshall(start)}:{})}));
  const items=await Promise.all((result.Items??[]).map(async item=>{const p=unmarshall(item);return this.read(orgId,actor,String(p.proposalId),principal);}));
  return {items,nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(unmarshall(result.LastEvaluatedKey))).toString('base64url'):null};
 }
 static async submit(orgId:string,actor:string,raw:unknown) {
  await Access.authorize(orgId,actor,true,false);
  const input=LegalProposalRequestSchema.parse(raw);
  for(const a of input.evidenceArtifacts) {if(a.format!=='LIASS-AUTHORITY-JSON-1') throw new AppError(422,'AUTHORITY_ARTIFACT_FORMAT_UNSUPPORTED');assertArtifact(a);}
  if(new Set(input.evidenceArtifacts.map(a=>a.reference)).size!==input.evidenceArtifacts.length) throw new AppError(422,'AUTHORITY_DUPLICATE_ARTIFACT');
  const row={...key(orgId,K.organizationLegalProposalSK(input.proposalId)),entityType:'ORGANIZATION_LEGAL_IDENTITY_PROPOSAL',orgId,
    ...input,proposedByUserId:actor,submittedAt:new Date().toISOString(),version:1};admission(row,131072);
  const old=await get(orgId,row.SK);
  if(old) {if(old.proposedByUserId!==actor || canonical({seller:old.seller,legalEntityReference:old.legalEntityReference,evidenceArtifacts:old.evidenceArtifacts})!==canonical({seller:input.seller,legalEntityReference:input.legalEntityReference,evidenceArtifacts:input.evidenceArtifacts})) throw conflict();return {proposalId:input.proposalId,version:1};}
  try {await dynamoClient.send(new TransactWriteItemsCommand({TransactItems:[Access.membershipCheck(orgId,actor),{Put:{TableName:table(),Item:marshall(row),ConditionExpression:'attribute_not_exists(PK) AND attribute_not_exists(SK)'}}]}));}
  catch(e){if((e as Error).name==='TransactionCanceledException')throw conflict();throw e;}
  return {proposalId:input.proposalId,version:1};
 }
 static async read(orgId:string,actor:string,proposalId:string,principal?:PlatformPrincipal) {
  z.string().uuid().parse(proposalId);
  if(principal) await requireLegalReviewer(principal);else await Access.authorize(orgId,actor,false,false);
  const proposal=await get(orgId,K.organizationLegalProposalSK(proposalId));
  if(!proposal || proposal.entityType!=='ORGANIZATION_LEGAL_IDENTITY_PROPOSAL')throw new AppError(404,'ERROR_NOT_FOUND');
  const decision = await get(orgId,K.organizationLegalDecisionSK(proposalId));
  const publicRow = (row: Record<string,unknown>) => {const {PK,SK,entityType,...data}=row;return data;};
  return {proposal:publicRow(proposal),decision:decision?publicRow(decision):null};
 }
 static async review(orgId:string,principal:PlatformPrincipal,proposalId:string,raw:unknown) {
  const grant=await requireLegalReviewer(principal);
  const {proposal}=await this.read(orgId,principal.sub,proposalId,principal);
  if(proposal.proposedByUserId===principal.sub) throw new AppError(403,'AUTHORITY_REVIEW_NOT_AUTHORIZED');
  const input=LegalReviewRequestSchema.parse(raw);
  if(await get(orgId,K.organizationLegalDecisionSK(proposalId)))throw conflict();
  if(input.decision==='ACCEPTED') {
    if(input.revision.orgId!==orgId || input.revision.legalEntityReference!==proposal.legalEntityReference || canonical(input.revision.seller)!==canonical(proposal.seller))throw conflict();
    const artifacts=proposal.evidenceArtifacts as z.infer<typeof AuthorityArtifactSchema>[];
    if(artifacts.some(a=>!input.revision.evidenceArtifacts.some(b=>canonical(a)===canonical(b))))throw new AppError(422,'AUTHORITY_FACT_PROOF_MISSING');
    await Identity.createRevision(orgId,principal,input.revision);
  }
  const decision={...key(orgId,K.organizationLegalDecisionSK(proposalId)),entityType:'ORGANIZATION_LEGAL_IDENTITY_DECISION',orgId,proposalId,
    reviewedByUserId:principal.sub,reviewedAt:new Date().toISOString(),decision:input.decision,
    ...(input.decision==='ACCEPTED'?{revisionId:input.revision.identityReference}:{reason:input.reason})};
  await dynamoClient.send(new TransactWriteItemsCommand({TransactItems:[grant.check,
    {ConditionCheck:{TableName:table(),Key:marshall(key(orgId,K.organizationLegalProposalSK(proposalId))),ConditionExpression:'entityType = :type AND proposedByUserId = :owner',ExpressionAttributeValues:marshall({':type':'ORGANIZATION_LEGAL_IDENTITY_PROPOSAL',':owner':proposal.proposedByUserId})}},
    {Put:{TableName:table(),Item:marshall(decision),ConditionExpression:'attribute_not_exists(PK) AND attribute_not_exists(SK)'}}]})).catch((e:unknown)=>{if((e as Error).name==='TransactionCanceledException')throw conflict();throw e;});
  return {proposalId,decision:input.decision};
 }
 static async activate(orgId:string,principal:PlatformPrincipal,proposalId:string,expectedVersion:number) {
  const {proposal,decision}=await this.read(orgId,principal.sub,proposalId,principal);
  if(proposal.proposedByUserId===principal.sub || decision?.decision!=='ACCEPTED')throw new AppError(403,'AUTHORITY_REVIEW_NOT_AUTHORIZED');
  await Identity.activate(orgId,principal,String(decision.revisionId),expectedVersion);
  return {proposalId,revisionId:decision.revisionId,status:'ACTIVE'};
 }
}
