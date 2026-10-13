import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MatFormField,
  MatFormFieldModule,
  MAT_FORM_FIELD_DEFAULT_OPTIONS,
} from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { By } from '@angular/platform-browser';
import { appConfig } from './app.config';

@Component({
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <mat-form-field><mat-label>Name</mat-label><input matInput /></mat-form-field>
    <mat-form-field><mat-label>Notes</mat-label><textarea matInput></textarea></mat-form-field>
    <mat-form-field
      ><mat-label>Status</mat-label
      ><mat-select><mat-option value="active">Active</mat-option></mat-select></mat-form-field
    >
  `,
})
class FormProbe {}

describe('Canonical Material form configuration', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('applies the actual application outline default to single-line, multiline and bounded controls', () => {
    TestBed.configureTestingModule({ imports: [FormProbe], providers: appConfig.providers });
    expect(TestBed.inject(MAT_FORM_FIELD_DEFAULT_OPTIONS).appearance).toBe('outline');
    const fixture = TestBed.createComponent(FormProbe);
    fixture.detectChanges();
    expect(
      fixture.debugElement
        .queryAll(By.directive(MatFormField))
        .map((field) => field.componentInstance.appearance),
    ).toEqual(['outline', 'outline', 'outline']);
  });
});
