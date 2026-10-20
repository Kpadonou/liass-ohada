import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoModule } from '@ngneat/transloco';
import {
  injectInfiniteQuery,
  injectQuery,
  QueryClient,
  InfiniteData,
} from '@tanstack/angular-query-experimental';
import { AuthStore } from '../../identity/data-access/auth.store';
import { ProductAccessState } from '../../../core/product-access/product-access.state';
import { RestaurantsCapabilities } from '../data-access/restaurants-capabilities';
import { ServiceOrderContext } from '../data-access/restaurant-orders.api';
import {
  RestaurantReceiptApi,
  ReceiptPage,
  ReceiptProgress,
} from '../data-access/restaurant-receipt.api';
import { RestaurantReceiptFlow, receiptKey } from '../data-access/restaurant-receipt-flow';
import { RestaurantReceiptPrint } from '../data-access/restaurant-receipt-print';
import { RestaurantReceiptDocument } from './restaurant-receipt-document.component';
const denied = (error: unknown) =>
  error instanceof HttpErrorResponse && [401, 403].includes(error.status);
@Component({
  selector: 'liass-receipt-view',
  host: { class: 'block min-w-0' },
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    TranslocoModule,
    RestaurantReceiptDocument,
  ],
  template: ` @if (!rejected()) {
    @if (closed()) {
      <p role="status" class="mb-3 text-sm font-medium">
        {{ 'RESTAURANTS.RECEIPT.TABLE_CLOSED' | transloco }}
      </p>
    }
    @if (building()) {
      <section class="mb-4" aria-live="polite" aria-busy="true">
        <p>{{ 'RESTAURANTS.RECEIPT.PREPARING' | transloco }}</p>
        @if (completedParts()) {
          <p class="text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.RECEIPT.BUILD_PROGRESS' | transloco: { count: completedParts() } }}
          </p>
        }
        <mat-progress-bar
          mode="indeterminate"
          [attr.aria-label]="'RESTAURANTS.RECEIPT.PREPARING' | transloco"
        />
      </section>
    }
    @if (resumeNeeded() && !building()) {
      <section class="mb-4">
        <p role="status">{{ 'RESTAURANTS.RECEIPT.RESUME_COPY' | transloco }}</p>
        <button mat-flat-button type="button" (click)="resume()">
          {{ 'RESTAURANTS.RECEIPT.RESUME' | transloco }}
        </button>
      </section>
    }
    @if (error()) {
      <p role="alert" class="mb-3 text-sm">{{ 'RESTAURANTS.RECEIPT.' + error() | transloco }}</p>
    }
    @if (verified() && first.data(); as receipt) {
      <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
        @if (printBusy()) {
          <p role="status" class="text-sm">
            {{
              'RESTAURANTS.RECEIPT.PRINT_PROGRESS'
                | transloco: { loaded: loadedCount(), total: receipt.data.partCount }
            }}
          </p>
          <button mat-button type="button" (click)="cancelPrint()">
            {{ 'RESTAURANTS.RECEIPT.CANCEL_PRINT' | transloco }}
          </button>
        } @else {
          <button
            #printButton
            mat-flat-button
            type="button"
            [disabled]="pages.isFetching()"
            (click)="print()"
          >
            <mat-icon>print</mat-icon>{{ 'RESTAURANTS.RECEIPT.PRINT' | transloco }}
          </button>
        }
      </div>
      @if (printBusy()) {
        <mat-progress-bar
          mode="determinate"
          [value]="receipt.data.partCount ? (loadedCount() / receipt.data.partCount) * 100 : 100"
          [attr.aria-label]="'RESTAURANTS.RECEIPT.PRINT_PREPARING' | transloco"
        />
      }
      <div class="rounded-app-card border border-app-border">
        <liass-receipt-document [summary]="receipt.data" [parts]="visibleParts()" />
      </div>
      @if (moreVisible()) {
        <div class="mt-3">
          <p class="mb-2 text-xs text-app-text-secondary">
            {{ 'RESTAURANTS.RECEIPT.PARTIAL' | transloco }}
          </p>
          <button
            mat-stroked-button
            type="button"
            [disabled]="pages.isFetchingNextPage() || printBusy()"
            [attr.aria-busy]="pages.isFetchingNextPage()"
            (click)="more()"
          >
            {{ 'RESTAURANTS.RECEIPT.MORE' | transloco }}
          </button>
        </div>
      }
    } @else if (first.isPending() && !building() && !resumeNeeded()) {
      <p role="status">{{ 'RESTAURANTS.RECEIPT.LOADING' | transloco }}</p>
    }
    @if (first.isError() && !resumeNeeded() && !building()) {
      <button mat-button type="button" (click)="first.refetch()">
        {{ 'RESTAURANTS.RECEIPT.RETRY' | transloco }}
      </button>
    }
  }`,
})
export class RestaurantReceiptView {
  readonly ctx = input.required<ServiceOrderContext>();
  readonly closed = input(false);
  readonly accessDenied = output<void>();
  private readonly client = inject(QueryClient);
  private readonly api = inject(RestaurantReceiptApi);
  private readonly flow = inject(RestaurantReceiptFlow);
  private readonly printer = inject(RestaurantReceiptPrint);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly auth = inject(AuthStore);
  private readonly entitlement = inject(ProductAccessState);
  private readonly destroy = inject(DestroyRef);
  private live = true;
  private printJob = 0;
  private readonly document = viewChild(RestaurantReceiptDocument);
  private readonly printButton = viewChild('printButton', { read: ElementRef });
  readonly completedParts = signal(0);
  readonly building = signal(false);
  readonly resumeNeeded = signal(false);
  readonly ready = signal(false);
  readonly verified = signal(false);
  readonly rejected = signal(false);
  readonly error = signal('');
  readonly printBusy = signal(false);
  readonly printAll = signal(false);
  readonly visiblePages = signal(1);
  readonly first = injectQuery(() => ({
    queryKey: [...receiptKey(this.ctx()), 'entry'],
    queryFn: async () => {
      const ctx = this.ctx();
      const page = await this.api.page(ctx);
      if (!this.current(ctx)) throw new Error('Receipt context changed');
      this.validate(page);
      if (page.parts.length && page.parts[0].number !== 1)
        throw new Error('Receipt first page mismatch');
      this.verified.set(true);
      this.resumeNeeded.set(false);
      this.error.set('');
      return page;
    },
    enabled: (!this.closed() || this.ready()) && !this.building() && !this.rejected(),
    retry: false,
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  }));
  readonly pages = injectInfiniteQuery(() => ({
    queryKey: [...receiptKey(this.ctx()), 'parts', this.first.data()?.data.digest ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const ctx = this.ctx();
      const result = pageParam
        ? await this.api.page(ctx, pageParam, this.printBusy() ? 8 : 4)
        : this.first.data()!;
      if (!this.current(ctx)) throw new Error('Receipt context changed');
      this.validate(result);
      if (pageParam) {
        const cached = this.client.getQueryData<InfiniteData<ReceiptPage>>([
          ...receiptKey(ctx),
          'parts',
          this.first.data()!.data.digest,
        ]);
        const previous = cached?.pages.at(-1)?.parts.at(-1)?.number ?? 0;
        if (
          result.parts[0]?.number !== previous + 1 ||
          (result.nextCursor && cached?.pages.some((p) => p.nextCursor === result.nextCursor))
        )
          throw new Error('Receipt pagination did not advance');
      }
      if (JSON.stringify(result.data) !== JSON.stringify(this.first.data()!.data))
        throw new Error('Receipt publication changed');
      return result;
    },
    getNextPageParam: (page: ReceiptPage) => page.nextCursor,
    enabled: this.verified() && !this.rejected(),
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
  readonly loadedCount = computed(
    () => this.pages.data()?.pages.reduce((n, p) => n + p.parts.length, 0) ?? 0,
  );
  readonly visibleParts = computed(
    () =>
      this.pages
        .data()
        ?.pages.slice(0, this.printAll() ? undefined : this.visiblePages())
        .flatMap((p) => p.parts) ?? [],
  );
  readonly moreVisible = computed(
    () => this.visiblePages() < (this.pages.data()?.pages.length ?? 0) || this.pages.hasNextPage(),
  );
  constructor() {
    this.destroy.onDestroy(() => {
      this.live = false;
      this.printJob++;
    });
    let started = false;
    effect(() => {
      if (this.closed() && !started) {
        started = true;
        void this.resume();
      }
    });
    effect(() => {
      const error = this.first.error() ?? this.pages.error();
      if (denied(error)) this.reject();
      else if (error instanceof HttpErrorResponse && error.status === 404 && !this.ready()) {
        this.resumeNeeded.set(true);
      } else if (this.first.error() && !this.error()) this.error.set('READ_ERROR');
    });
  }
  current(ctx = this.ctx()) {
    return (
      this.live &&
      !this.rejected() &&
      this.caps.canReadReceipt() &&
      this.entitlement.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.auth.effectiveOrgId() === ctx.org &&
      this.auth.currentUserId() === ctx.user &&
      this.auth.contextRevision() === ctx.revision &&
      JSON.stringify(ctx) === JSON.stringify(this.ctx())
    );
  }
  private reject() {
    this.rejected.set(true);
    this.verified.set(false);
    this.printJob++;
    this.accessDenied.emit();
  }
  private validate(page: ReceiptPage) {
    if (page.data.partCount && !page.parts.length) throw new Error('Missing receipt parts');
    let previous = 0;
    for (const p of page.parts) {
      if (previous && p.number !== previous + 1) throw new Error('Receipt parts out of order');
      previous = p.number;
    }
    const last = page.parts.at(-1)?.number ?? 0;
    if (last > page.data.partCount || (!page.nextCursor && last !== page.data.partCount))
      throw new Error('Incomplete receipt page');
  }
  async resume() {
    if (this.building() || !this.current() || !this.caps.canPublishReceipt()) return;
    const ctx = this.ctx();
    this.building.set(true);
    this.error.set('');
    this.resumeNeeded.set(false);
    try {
      const done = await this.flow.resume(
        ctx,
        () => this.current(ctx),
        (value: ReceiptProgress) => {
          if (value.state === 'BUILDING') this.completedParts.set(value.partCount);
        },
      );
      if (!this.current(ctx)) return;
      this.ready.set(done);
      this.resumeNeeded.set(!done);
      if (done) await this.first.refetch();
    } catch (error) {
      if (this.current(ctx)) {
        if (denied(error)) this.reject();
        else {
          this.error.set('PUBLICATION_ERROR');
          this.resumeNeeded.set(true);
        }
      }
    } finally {
      if (this.live) this.building.set(false);
    }
  }
  async more() {
    if (!this.current() || this.pages.isFetching() || this.printBusy()) return;
    this.error.set('');
    if (this.visiblePages() < (this.pages.data()?.pages.length ?? 0)) {
      this.visiblePages.update((n) => n + 1);
      return;
    }
    const ctx = this.ctx();
    const result = await this.pages.fetchNextPage();
    if (!this.current(ctx)) return;
    if (result.isError) {
      if (denied(result.error)) this.reject();
      else this.error.set('READ_ERROR');
    } else this.visiblePages.update((n) => n + 1);
  }
  cancelPrint() {
    this.printJob++;
    this.printBusy.set(false);
    this.printAll.set(false);
  }
  async print() {
    if (!this.current() || this.printBusy() || !this.verified() || this.pages.isFetching()) return;
    const ctx = this.ctx(),
      job = ++this.printJob;
    this.error.set('');
    try {
      if (this.pages.hasNextPage()) this.printBusy.set(true);
      let requests = 0,
        next = this.pages.hasNextPage();
      while (next && this.current(ctx) && job === this.printJob) {
        if (++requests > this.first.data()!.data.partCount + 1)
          throw new Error('Receipt pagination budget');
        const result = await this.pages.fetchNextPage();
        if (result.isError) throw result.error;
        next = result.hasNextPage;
      }
      if (!this.current(ctx) || job !== this.printJob) return;
      if (next) throw new Error('Receipt is incomplete');
      this.printAll.set(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (
        this.current(ctx) &&
        job === this.printJob &&
        this.document() &&
        this.loadedCount() === this.first.data()!.data.partCount
      )
        this.printer.print(this.document()!.element.nativeElement);
    } catch (error) {
      if (this.current(ctx)) {
        if (denied(error)) this.reject();
        else this.error.set('PRINT_ERROR');
      }
    } finally {
      if (this.live && job === this.printJob) {
        this.printAll.set(false);
        this.printBusy.set(false);
        this.printButton()?.nativeElement.focus({ preventScroll: true });
      }
    }
  }
}
@Component({
  selector: 'liass-restaurant-receipt',
  host: { class: 'block min-w-0' },
  imports: [RestaurantReceiptView, RouterLink, MatButtonModule, TranslocoModule],
  template: `<div class="mx-auto max-w-3xl">
    <nav class="mb-3">
      <a mat-button routerLink="/restaurants/checkout">{{
        'RESTAURANTS.RECEIPT.BACK' | transloco
      }}</a>
    </nav>
    @if (allowed()) {
      @for (item of contexts(); track item.key) {
        <liass-receipt-view
          [ctx]="item.ctx"
          [closed]="afterClose"
          (accessDenied)="deniedIdentity.set(identity())"
        />
      }
    } @else {
      <p role="alert">{{ 'RESTAURANTS.RECEIPT.ACCESS' | transloco }}</p>
    }
  </div>`,
})
export class RestaurantReceiptPage {
  private readonly auth = inject(AuthStore);
  private readonly caps = inject(RestaurantsCapabilities);
  private readonly access = inject(ProductAccessState);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly afterClose =
    this.router.getCurrentNavigation()?.extras.state?.['checkoutClosed'] === true;
  readonly identity = computed(() =>
    JSON.stringify([
      this.auth.effectiveOrgId(),
      this.auth.currentUserId(),
      this.auth.contextRevision(),
      this.params().get('outletId'),
      this.params().get('sessionId'),
    ]),
  );
  readonly deniedIdentity = signal('');
  readonly allowed = computed(
    () =>
      this.caps.canReadReceipt() &&
      this.access.availability('RESTAURANTS') === 'AVAILABLE' &&
      this.identity() !== this.deniedIdentity(),
  );
  readonly contexts = computed(() => [
    {
      key: this.identity(),
      ctx: {
        org: this.auth.effectiveOrgId()!,
        user: this.auth.currentUserId()!,
        revision: this.auth.contextRevision(),
        outlet: this.params().get('outletId') ?? '',
        session: this.params().get('sessionId') ?? '',
      },
    },
  ]);
}
