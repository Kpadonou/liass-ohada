import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
/** Temporary print-only DOM representation; no document data or auth authority is stored here. */
@Injectable({ providedIn: 'root' })
export class RestaurantReceiptPrint {
  private readonly document = inject(DOCUMENT);
  print(element: HTMLElement) {
    const root = this.document.createElement('div');
    root.className = 'liass-receipt-print-root';
    root.append(element.cloneNode(true));
    this.document.body.append(root);
    this.document.body.classList.add('liass-receipt-printing');
    try {
      this.document.defaultView?.print();
    } finally {
      root.remove();
      this.document.body.classList.remove('liass-receipt-printing');
    }
  }
}
