import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';
import { AuthorityArtifactSchema, LegalSellerAuthoritySchema } from '@liass-ohada/shared/shared';
import { AuthStore } from './auth.store';
import { environment } from '../../../../environments/environment';
export const ProposalInput = z.object({proposalId:z.uuid(),seller:LegalSellerAuthoritySchema.shape.seller,legalEntityReference:z.string().min(1).max(200),evidenceArtifacts:z.array(AuthorityArtifactSchema).min(1).max(60)}).strict();
export const Proposal = ProposalInput.extend({orgId:z.string(),proposedByUserId:z.string(),submittedAt:z.iso.datetime(),version:z.literal(1)});
export const Decision = z.object({proposalId:z.uuid(),decision:z.enum(['ACCEPTED','REJECTED']),reviewedByUserId:z.string(),reviewedAt:z.iso.datetime(),revisionId:z.uuid().optional(),reason:z.string().optional()});
export const ProposalResult=z.object({proposal:Proposal,decision:Decision.nullable()});
export type LegalProposal = z.infer<typeof ProposalResult>;
@Injectable({providedIn:'root'})
export class LegalIdentityApi {
 readonly auth=inject(AuthStore);private readonly http=inject(HttpClient);
 private readonly base=environment.apiBaseUrl.replace(/\/$/,'');
 context(){return [this.auth.currentUserId(),this.auth.effectiveOrgId(),this.auth.contextRevision()] as const;}
 private async request<T>(schema:z.ZodType<T>,url:string,body?:unknown){const context=JSON.stringify(this.context());if(!this.auth.currentUserId())throw new Error('WORKSPACE_CHANGED');
 const result=await firstValueFrom((body===undefined?this.http.get<unknown>(this.base+url):this.http.post<unknown>(this.base+url,body)).pipe(timeout(35000)));
 if(context!==JSON.stringify(this.context()))throw new Error('WORKSPACE_CHANGED');return z.object({data:schema}).parse(result).data;}
 capability(){return this.request(z.object({canReview:z.boolean()}),'/platform/legal-identity/capability');}
 private path(org:string,review:boolean){if(!review&&org!==this.auth.effectiveOrgId())throw new Error('WORKSPACE_CHANGED');return review?'/platform/organizations/'+encodeURIComponent(org)+'/legal-identity':'/me/organization/legal-identity';}
 list(org:string,review=false,cursor?:string){return this.request(z.object({items:z.array(ProposalResult.refine(item=>item.proposal.orgId===org)),nextCursor:z.string().nullable()}),this.path(org,review)+'/proposals'+(cursor?'?cursor='+encodeURIComponent(cursor):''));}
 submit(org:string,input:unknown){return this.request(z.object({proposalId:z.uuid(),version:z.literal(1)}),this.path(org,false)+'/proposals',ProposalInput.parse(input));}
 selected(org:string){return this.request(z.object({authority:LegalSellerAuthoritySchema.refine(a=>a.orgId===org).nullable(),selectionVersion:z.number().int().nonnegative()}),this.path(org,true)+'/context');}
 review(org:string,id:string,body:unknown){return this.request(z.object({proposalId:z.uuid(),decision:z.enum(['ACCEPTED','REJECTED'])}),this.path(org,true)+'/proposals/'+z.uuid().parse(id)+'/review',body);}
 activate(org:string,id:string,expectedVersion:number){return this.request(z.object({proposalId:z.uuid(),revisionId:z.uuid(),status:z.literal('ACTIVE')}),this.path(org,true)+'/proposals/'+z.uuid().parse(id)+'/activation',{expectedVersion});}
}
