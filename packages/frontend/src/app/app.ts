import { BrowserSessionContext } from './core/auth/browser-session-context';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'liass-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly browserSessionContext = inject(BrowserSessionContext);
}
