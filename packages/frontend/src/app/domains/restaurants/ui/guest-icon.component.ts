import { Component, input } from '@angular/core';

// Local outline icons keep the public Guest experience independent of icon fonts.
const paths = {
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6.1 6.1a8 8 0 0 1 13 2.9 M4.9 15a8 8 0 0 0 13 2.9',
  table:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 5v14 M5 12h14',
  bell: 'M3 20h18 M5 17a7 7 0 0 1 14 0H5 M12 10V7 M10 7h4',
  phone:
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2',
  cart: 'M2 3h3l3 14h11l3-10H6 M10 21h.01 M18 21h.01',
  chevron: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12 M6 18L18 6',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  note: 'M12 20H3v-9 M16 3l5 5-11 11-6 1 1-6L16 3',
  info: 'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  send: 'M22 2L9 15 M22 2l-8 20-5-7-7-5L22 2',
  preparing:
    'M6 13a4 4 0 0 1-2-7 4 4 0 0 1 5-3 4 4 0 0 1 6 0 4 4 0 0 1 5 3 4 4 0 0 1-2 7v8H6v-8 M6 17h12',
  check: 'M8 12l3 3 5-6 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  clock: 'M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const;
export type GuestIconName = keyof typeof paths;

@Component({
  selector: 'liass-guest-icon',
  host: { class: 'inline-flex shrink-0 items-center justify-center', 'aria-hidden': 'true' },
  template: `<svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    class="h-full w-full"
  >
    <path [attr.d]="paths[name()]" />
  </svg>`,
})
export class GuestIconComponent {
  readonly name = input.required<GuestIconName>();
  protected readonly paths = paths;
}
