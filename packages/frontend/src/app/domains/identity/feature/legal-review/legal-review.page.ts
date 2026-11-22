import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { LegalIdentityApi } from '../../data-access/legal-identity.api';
import { LegalProposalsComponent } from '../../ui/legal-proposals.component';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
@Component({selector:'liass-legal-review-page',imports:[ReactiveFormsModule,MatFormFieldModule,MatInputModule,TranslocoModule,LegalProposalsComponent,LiassPageHeaderComponent,LiassCardComponent,LiassButtonComponent],template:`
<div class="space-y-5"><liass-page-header [title]="'LEGAL_UI.REVIEW_TITLE' | transloco" [eyebrow]="'LEGAL_UI.PLATFORM' | transloco" [subtitle]="'LEGAL_UI.REVIEW_HINT' | transloco"/>
@if(capability.isPending()){<liass-card state="loading"/>}
@else if(capability.isError()){<liass-card><p role="alert">{{ 'LEGAL_UI.ERROR' | transloco }}</p><liass-button (pressed)="capability.refetch()">{{ 'LEGAL_UI.REFRESH' | transloco }}</liass-button></liass-card>}
@else if(!capability.data()?.canReview){<liass-card><p role="alert">{{ 'LEGAL_UI.NO_ACCESS' | transloco }}</p></liass-card>}
@else {
<liass-card><form (submit)="$event.preventDefault();open()" class="flex flex-wrap items-start gap-3"><mat-form-field class="min-w-0 flex-1"><mat-label>{{ 'LEGAL_UI.ORGANIZATION' | transloco }}</mat-label><input matInput [formControl]="organization"/><mat-error>{{ 'LEGAL_UI.INVALID' | transloco }}</mat-error></mat-form-field><liass-button type="submit" [disabled]="organization.invalid">{{ 'LEGAL_UI.OPEN' | transloco }}</liass-button></form></liass-card>
@if(org()){
@if(selected.isPending()){<liass-card state="loading"/>}
@else if(selected.isError()){<liass-card><p role="alert">{{ 'LEGAL_UI.ERROR' | transloco }}</p><liass-button (pressed)="selected.refetch()">{{ 'LEGAL_UI.REFRESH' | transloco }}</liass-button></liass-card>}
@else {<liass-card><h2 class="font-semibold">{{ 'LEGAL_UI.CURRENT' | transloco }}</h2>@if(selected.data()?.authority;as a){<p class="mt-2">{{a.seller.name}} · {{a.identityVersion}}</p><p class="break-words">{{a.seller.address?.lines?.join(', ')}}</p><p>{{a.seller.address?.city}} {{a.seller.address?.postalCode}}</p><p>{{a.seller.country}}</p>@for(identifier of a.seller.identifiers;track $index){<p>{{identifier.scheme}} · {{identifier.issuingCountry}} · {{identifier.value}}</p>}@for(fact of a.factStates;track fact.fieldPath){<p class="text-sm">{{fact.fieldPath}} · {{('LEGAL_UI.'+fact.state)|transloco}}</p>}}@else{<p>{{ 'LEGAL_UI.NO_CURRENT' | transloco }}</p>}</liass-card>
<liass-legal-proposals [org]="org()" [review]="true" [authority]="selected.data()?.authority ?? null" [selectionVersion]="selected.data()?.selectionVersion ?? 0"/>}
}
}
</div>`})
export class LegalReviewPage {
 readonly api=inject(LegalIdentityApi);readonly org=signal('');
 readonly organization=new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.pattern(/^[A-Za-z0-9_-]{1,200}$/)]});
 readonly capability=injectQuery(()=>({queryKey:['identity','legal-review-capability',...this.api.context()],queryFn:()=>this.api.capability(),staleTime:60000}));
 readonly selected=injectQuery(()=>({queryKey:['identity','legal-review-context',this.org(),...this.api.context()],queryFn:()=>this.api.selected(this.org()),enabled:!!this.org()&&this.capability.data()?.canReview===true,staleTime:30000}));
 open(){if(this.organization.valid&&this.capability.data()?.canReview)this.org.set(this.organization.value);}
}
