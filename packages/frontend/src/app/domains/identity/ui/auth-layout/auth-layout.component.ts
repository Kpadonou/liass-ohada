import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

@Component({
  selector: 'liass-auth-layout',
  imports: [RouterModule, TranslocoModule],
  templateUrl: './auth-layout.component.html'
})
export class AuthLayoutComponent {}
