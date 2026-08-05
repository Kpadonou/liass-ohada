import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@ngneat/transloco';

import { PublicPreviewMotionDirective } from './public-preview-motion.directive';

@Component({
  selector: 'liass-public-product-preview',
  imports: [MatIconModule, PublicPreviewMotionDirective, TranslocoModule],
  templateUrl: './public-product-preview.component.html',
  styleUrl: './public-product-preview.component.css',
})
export class PublicProductPreviewComponent {}
