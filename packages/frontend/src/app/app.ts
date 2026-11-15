import { BrowserSessionContext } from './core/auth/browser-session-context';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';
import { FontPreviewSelectorComponent } from './core/devtools/font-preview-selector.component';

@Component({
  selector: 'liass-root',
  imports: [RouterOutlet, FontPreviewSelectorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly fontPreviewEnabled = !environment.production;
  private readonly browserSessionContext = inject(BrowserSessionContext);
}
