import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoModule } from '@ngneat/transloco';
import { injectQuery, injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { OrganizationProfileApi } from '../../data-access/organization-profile.api';
import { LiassPageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { LiassCardComponent } from '../../../../shared/ui/card/card.component';
import { LiassButtonComponent } from '../../../../shared/ui/button/button.component';
import { LiassStatusChipComponent } from '../../../../shared/ui/status-chip/status-chip.component';
@Component({selector: 'liass-organization-profile', templateUrl: './organization-profile.page.html',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, TranslocoModule,
    LiassPageHeaderComponent, LiassCardComponent, LiassButtonComponent, LiassStatusChipComponent]})
export class OrganizationProfilePage {
  readonly api = inject(OrganizationProfileApi);
  private readonly client = inject(QueryClient);
  readonly saved = signal<string | null>(null);
  isSaved() { return this.saved() === JSON.stringify(this.api.context()); }
  readonly fields = ['email', 'phone', 'address', 'city', 'postalCode'] as const;
  readonly form = new FormGroup({ email: new FormControl('', {nonNullable: true, validators: [Validators.email, Validators.maxLength(254)]}),
    phone: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    address: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    city: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}),
    postalCode: new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)}) });
  readonly query = injectQuery(() => { const context = this.api.context(); return {
    queryKey: ['identity', 'organization-profile', ...context], enabled: !!context[0] && !!context[1],
    queryFn: () => this.api.read(context), staleTime: 60_000 }; });
  readonly mutation = injectMutation(() => ({ mutationFn: (input: {context: ReturnType<OrganizationProfileApi['context']>; body: unknown}) => this.api.update(input.context, input.body),
    onSuccess: (data, input) => { this.client.setQueryData(['identity', 'organization-profile', ...input.context], data); this.saved.set(JSON.stringify(input.context)); } }));
  private formContext = "";
  constructor() { effect(() => { const data = this.query.data(); const context = JSON.stringify(this.api.context());
    if (context === this.formContext && this.form.dirty && !this.mutation.isSuccess()) return;
    this.formContext = context;
    this.form.reset(data?.contact ?? {email:'',phone:'',address:'',city:'',postalCode:''});
    if (data?.canManage) this.form.enable(); else this.form.disable(); }); }
  save() { const data = this.query.data(); if (!data?.canManage || this.form.invalid || this.mutation.isPending()) return;
    this.saved.set(null); this.mutation.mutate({context: this.api.context(), body: {expectedVersion: data.version, contact: this.form.getRawValue()}}); }
}
