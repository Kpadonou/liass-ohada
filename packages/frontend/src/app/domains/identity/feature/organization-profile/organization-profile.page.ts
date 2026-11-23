import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { OrganizationProfileApi } from '../../data-access/organization-profile.api';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
@Component({selector: 'liass-organization-profile', templateUrl: './organization-profile.page.html',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatCheckboxModule, TranslocoModule,
    LiassPageHeaderComponent, LiassCardComponent, LiassButtonComponent, LiassStatusChipComponent]})
export class OrganizationProfilePage {
  readonly api = inject(OrganizationProfileApi);
  private readonly client = inject(QueryClient);
  readonly saved = signal<string | null>(null);
  private legalSubmitting = false;
  legalErrorKey() { const error = this.legalMutation.error(); const status = error instanceof HttpErrorResponse ? error.status : 0;
    return status === 409 ? 'ORG_PROFILE.CONFLICT' : status === 403 ? 'ORG_PROFILE.FORBIDDEN' : 'ORG_PROFILE.SAVE_ERROR'; }
  isSaved() { return this.saved() === JSON.stringify(this.api.context()); }
  readonly fields = ['email', 'phone', 'address', 'city', 'postalCode'] as const;
  readonly form = new FormGroup({ email: new FormControl('', {nonNullable: true, validators: [Validators.email, Validators.maxLength(254)]}),
    phone: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    address: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    city: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    postalCode: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}) });
  readonly legalForm = new FormGroup({line1: new FormControl('', {nonNullable:true,validators:[Validators.required,Validators.maxLength(300)]}),
    city: new FormControl('', {nonNullable:true,validators:Validators.maxLength(160)}),
    postalCode: new FormControl('', {nonNullable:true,validators:Validators.maxLength(32)}),
    attested: new FormControl(false,{nonNullable:true,validators:Validators.requiredTrue})});
  readonly query = injectQuery(() => { const context = this.api.context(); return {
    queryKey: ['identity', 'organization-profile', ...context], enabled: !!context[0] && !!context[1],
    queryFn: () => this.api.read(context), staleTime: 60_000 }; });
  readonly mutation = injectMutation(() => ({ mutationFn: (input: {context: ReturnType<OrganizationProfileApi['context']>; body: unknown}) => this.api.update(input.context, input.body),
    onSuccess: (data, input) => { this.client.setQueryData(['identity', 'organization-profile', ...input.context], data); this.saved.set(JSON.stringify(input.context));
      if (JSON.stringify(input.context) === JSON.stringify(this.api.context())) this.form.reset(data.contact); } }));
  readonly legalMutation = injectMutation(() => ({mutationFn: (input: {context: ReturnType<OrganizationProfileApi['context']>; body: unknown}) => this.api.update(input.context,input.body),
    onSettled: () => { this.legalSubmitting = false; },
    onSuccess: (data,input) => { this.client.setQueryData(['identity','organization-profile',...input.context],data);
      if (JSON.stringify(input.context) === JSON.stringify(this.api.context())) { this.legalForm.markAsPristine(); this.legalForm.controls.attested.setValue(false); } }}));
  private formContext = "";
  constructor() { effect(() => { const data = this.query.data(); const context = JSON.stringify(this.api.context());
    const changedContext = context !== this.formContext;
    if (changedContext) { this.form.reset(); this.legalForm.reset(); }
    this.formContext = context;
    if (!this.form.dirty) this.form.reset(data?.contact ?? {email:'',phone:'',address:'',city:'',postalCode:''});
    const address = data?.legalIdentity?.authority?.seller.address;
    if (!this.legalForm.dirty && data?.legalIdentity?.authority) this.legalForm.reset({line1:address?.lines.join('\n') ?? '',city:address?.city ?? '',postalCode:address?.postalCode ?? '',attested:false});
    if (data?.canManage) this.form.enable(); else this.form.disable(); }); }
  save() { const data = this.query.data(); if (!data?.canManage || this.form.invalid || this.mutation.isPending()) return;
    this.saved.set(null); this.mutation.mutate({context: this.api.context(), body: {expectedVersion: data.version, contact: this.form.getRawValue()}}); }
  saveLegal() { const data = this.query.data(); if (!data?.canManage || !data.legalIdentity?.selectionVersion || this.legalForm.invalid || this.legalSubmitting || this.legalMutation.isPending()) return;
    this.legalSubmitting = true;
    const value = this.legalForm.getRawValue();
    this.legalMutation.mutate({context:this.api.context(),body:{legalAddress:{expectedSelectionVersion:data.legalIdentity.selectionVersion,
      address:{lines:value.line1.split('\n').map(v=>v.trim()).filter(Boolean),...(value.city?{city:value.city}:{}),...(value.postalCode?{postalCode:value.postalCode}:{})},attested:true}}}); }
}
