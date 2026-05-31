import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslocoModule } from '@ngneat/transloco';

import { AuthLayoutComponent } from '../../ui/auth-layout/auth-layout.component';

@Component({
  selector: 'liass-signup-page',
  imports: [AuthLayoutComponent, RouterModule, TranslocoModule],
  templateUrl: './signup.page.html'
})
export class SignupPage {}
