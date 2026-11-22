import { LiassSearchableSelectComponent } from '../../../shared/ui/searchable-select/searchable-select.component';
import { LiassConfirmationDialogComponent } from '../../../shared/ui/confirmation-dialog/confirmation-dialog.component';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Component, TemplateRef, ViewChild, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { LegalSellerAuthority } from '@liass-ohada/shared/shared';
import { LegalIdentityApi, LegalProposal } from '../data-access/legal-identity.api';
import { Artifact, parseEvidence, leaves, reviewedRevision } from '../utils/legal-evidence';
import { safeMessageFromError } from '../../../core/notifications/notification-message';
import { LiassButtonComponent } from '../../../shared/ui/button/button.component';
import { LiassCardComponent } from '../../../shared/ui/card/card.component';
import { LiassStatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
@Component({selector:'liass-legal-proposals',imports:[LiassSearchableSelectComponent, MatDialogModule, ReactiveFormsModule,MatFormFieldModule,MatInputModule,MatCheckboxModule,MatSelectModule,MatMenuModule,MatIconModule,TranslocoModule,LiassButtonComponent,LiassCardComponent,LiassStatusChipComponent],templateUrl:'./legal-proposals.component.html'})
export class LegalProposalsComponent {
 @ViewChild('details') details!: TemplateRef<unknown>;
 private readonly dialog=inject(MatDialog);private detailRef?:MatDialogRef<unknown>;
 readonly search=new FormControl('',{nonNullable:true});
 filtered(){const q=this.search.value.trim().toLocaleLowerCase();return (this.list.data()?.items??[]).filter(i=>i.proposal.seller.name.toLocaleLowerCase().includes(q));}
 readonly org=input.required<string>();readonly owner=input(false);readonly review=input(false);readonly authority=input<LegalSellerAuthority|null>(null);readonly selectionVersion=input(0);
 readonly api=inject(LegalIdentityApi);private readonly client=inject(QueryClient);
 readonly evidence=signal<Artifact[]>([]);readonly evidenceError=signal(false);readonly editing=signal(false);readonly selected=signal<LegalProposal|null>(null);readonly subject=new FormControl('',{nonNullable:true,validators:Validators.required});readonly reason=new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.maxLength(1000)]});
 readonly fieldNames=['name','ifu','line1','line2','line3','city','postalCode','country','legalEntityReference'] as const;
 readonly form=new FormGroup({name:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.maxLength(160)]}),ifu:new FormControl('',{nonNullable:true,validators:Validators.maxLength(100)}),line1:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.maxLength(300)]}),line2:new FormControl('',{nonNullable:true,validators:Validators.maxLength(300)}),line3:new FormControl('',{nonNullable:true,validators:Validators.maxLength(300)}),city:new FormControl('',{nonNullable:true,validators:Validators.maxLength(160)}),postalCode:new FormControl('',{nonNullable:true,validators:Validators.maxLength(32)}),country:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.pattern(/^[A-Z]{2}$/)]}),legalEntityReference:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.maxLength(200)]})});
 readonly cursor=signal<string|undefined>(undefined);private previous:string[]=[];readonly hasPrevious=signal(false);
 private scope(){return [this.org(),this.review(),...this.api.context()] as const;}
 readonly list=injectQuery(()=>{const scope=this.scope(),cursor=this.cursor();return {queryKey:['identity','legal-proposals',...scope,cursor],queryFn:()=>this.api.list(scope[0],scope[1],cursor),enabled:!!scope[0],staleTime:30000};});
 readonly mutation=injectMutation(()=>({mutationFn:async(action:'SUBMIT'|'ACCEPT'|'REJECT'|'ACTIVATE')=>{
   const org=this.org(),selection=this.selected(),context=JSON.stringify(this.scope());
   if(action==='SUBMIT'){if(!this.owner()||this.review()||this.form.invalid||!this.evidence().length)throw new Error('INVALID_EVIDENCE');const f=this.form.getRawValue(),identifiers=[...(this.authority()?.seller.identifiers??[])].filter(i=>!(i.scheme==='IFU' && i.issuingCountry===(this.authority()?.seller.country??f.country)));if(f.ifu.trim())identifiers.push({scheme:'IFU',issuingCountry:f.country,value:f.ifu.trim()});
    return this.api.submit(org,{proposalId:this.proposalId,seller:{name:f.name.trim(),country:f.country,address:{lines:[f.line1,f.line2,f.line3].map(x=>x.trim()).filter(Boolean),...(f.city.trim()?{city:f.city.trim()}:{}),...(f.postalCode.trim()?{postalCode:f.postalCode.trim()}: {})},identifiers},legalEntityReference:f.legalEntityReference.trim(),evidenceArtifacts:this.evidence()});}
   if(!this.review()||!selection||selection.proposal.proposedByUserId===this.api.auth.currentUserId())throw new Error('FORBIDDEN');
   if(action==='ACTIVATE')return this.api.activate(org,selection.proposal.proposalId,this.selectionVersion());
   if(action==='REJECT'){if(this.reason.invalid)throw new Error('INVALID_EVIDENCE');return this.api.review(org,selection.proposal.proposalId,{decision:'REJECTED',reason:this.reason.value});}
   if(!this.canAccept())throw new Error('INVALID_EVIDENCE');
   const revision=await reviewedRevision({orgId:org,actor:this.api.auth.currentUserId()!,seller:selection.proposal.seller,legalEntityReference:selection.proposal.legalEntityReference,evidence:selection.proposal.evidenceArtifacts,facts:this.facts().map(f=>({fieldPath:f.path,state:f.verified?'VERIFIED':'PRESENT',...(f.verified?{evidenceReference:f.evidence.value}:{})})),subjectEvidence:this.subject.value,selectionVersion:this.selectionVersion()});
   if(context!==JSON.stringify(this.scope()))throw new Error('WORKSPACE_CHANGED');
   return this.api.review(org,selection.proposal.proposalId,{decision:'ACCEPTED',revision});
 },onSuccess:async(_data,action)=>{this.editing.set(false);if(action==='SUBMIT'){this.proposalId=crypto.randomUUID();this.evidence.set([]);}this.selected.set(null);this.detailRef?.close();await this.client.invalidateQueries({queryKey:['identity','legal-proposals',this.org()]});await this.client.invalidateQueries({queryKey:['identity','legal-review-context',this.org()]});await this.client.invalidateQueries({queryKey:['identity','organization-profile',this.org()]});}}));
 private proposalId=crypto.randomUUID();readonly facts=signal<Array<{path:string;value:string;verified:boolean;reference:string;evidence:FormControl<string>}>>([]);
 canAccept(){return !!this.selected()&&!this.selected()?.decision&&this.subject.valid&&this.facts().some(f=>f.path==='name'&&f.verified)&&this.facts().filter(f=>f.verified).every(f=>!!f.evidence.value);}
 activate(){const scope=JSON.stringify(this.scope());this.dialog.open(LiassConfirmationDialogComponent,{data:{titleKey:'LEGAL_UI.ACTIVATE',descriptionKey:'LEGAL_UI.ACTIVATE_HINT',confirmKey:'LEGAL_UI.ACTIVATE',cancelKey:'LEGAL_UI.CANCEL',tone:'warning'}}).afterClosed().subscribe(yes=>{if(yes&&scope===JSON.stringify(this.scope()))this.mutation.mutate('ACTIVATE');});}
 evidenceOptions(){return (this.selected()?.proposal.evidenceArtifacts??[]).map(a=>({value:a.reference,label:a.reference}));}
 closeDetails(){this.detailRef?.close();this.selected.set(null);}
 fieldLabel(path:string){return path==='name'?'LEGAL_UI.name':path==='country'?'LEGAL_UI.country':path==='address.city'?'LEGAL_UI.city':path==='address.postalCode'?'LEGAL_UI.postalCode':path.startsWith('address.lines.')?'LEGAL_UI.ADDRESS':'LEGAL_UI.IDENTIFIER';}
 error(){return safeMessageFromError(this.mutation.error());}
 constructor(){effect(()=>{this.org();this.review();this.api.context();this.detailRef?.close();this.selected.set(null);this.editing.set(false);this.evidence.set([]);this.cursor.set(undefined);this.previous=[];this.hasPrevious.set(false);this.form.reset();});}
 edit(){const a=this.authority(),s=a?.seller;this.form.reset({name:s?.name??'',ifu:s?.identifiers.find(i=>i.scheme==='IFU' && i.issuingCountry===s?.country)?.value??'',line1:s?.address?.lines[0]??'',line2:s?.address?.lines[1]??'',line3:s?.address?.lines[2]??'',city:s?.address?.city??'',postalCode:s?.address?.postalCode??'',country:s?.country??'',legalEntityReference:a?.legalEntityReference??''});this.proposalId=crypto.randomUUID();this.evidence.set([]);this.editing.set(true);}
 async files(event:Event){const context=JSON.stringify(this.scope());this.evidenceError.set(false);const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;try{if(file.size>131072)throw new Error();const parsed=await parseEvidence(await file.text());if(context!==JSON.stringify(this.scope()))return;this.evidence.set(parsed);}catch{if(context!==JSON.stringify(this.scope()))return;this.evidence.set([]);this.evidenceError.set(true);}}
 inspect(item:LegalProposal){this.selected.set(item);this.subject.reset('');this.reason.reset('');this.facts.set(leaves(item.proposal.seller).map(f=>({...f,verified:false,reference:'',evidence:new FormControl('',{nonNullable:true})})));this.detailRef=this.dialog.open(this.details,{width:'760px',maxWidth:'calc(100vw - 24px)'});}
 setFact(index:number,change:{verified?:boolean;reference?:string}){this.facts.update(items=>items.map((f,i)=>i===index?{...f,...change}:f));}
 next(){const c=this.list.data()?.nextCursor;if(c){this.previous.push(this.cursor()??'');this.cursor.set(c);this.hasPrevious.set(true);}}
 back(){this.cursor.set(this.previous.pop()||undefined);this.hasPrevious.set(this.previous.length>0);}
}
