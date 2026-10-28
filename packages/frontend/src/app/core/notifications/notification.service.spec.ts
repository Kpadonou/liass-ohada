import { Subject } from 'rxjs';
import { NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  function setup() {
    const action = new Subject<void>();
    const open = vi.fn(() => ({ onAction: () => action.asObservable() }));
    const run = vi.fn((callback: () => void) => callback());

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: MatSnackBar, useValue: { open } },
        { provide: NgZone, useValue: { run } },
      ],
    });

    return {
      open,
      action,
      run,
      service: TestBed.inject(NotificationService),
    };
  }

  it('opens snackbars through Angular NgZone', () => {
    const { open, run, service } = setup();

    service.success('Created successfully.');

    expect(run).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('Created successfully.', undefined, {
      duration: 2000,
      panelClass: 'success-notification-overlay',
    });
  });

  it('uses the semantic overlay class for every notification type', () => {
    const { open, service } = setup();

    service.default('Default');
    service.info('Info');
    service.success('Success');
    service.warn('Warning');
    service.error('Error');

    expect(open).toHaveBeenNthCalledWith(1, 'Default', undefined, {
      duration: 2000,
      panelClass: 'default-notification-overlay',
    });
    expect(open).toHaveBeenNthCalledWith(2, 'Info', undefined, {
      duration: 2000,
      panelClass: 'info-notification-overlay',
    });
    expect(open).toHaveBeenNthCalledWith(3, 'Success', undefined, {
      duration: 2000,
      panelClass: 'success-notification-overlay',
    });
    expect(open).toHaveBeenNthCalledWith(4, 'Warning', undefined, {
      duration: 2500,
      panelClass: 'warning-notification-overlay',
    });
    expect(open).toHaveBeenNthCalledWith(5, 'Error', undefined, {
      duration: 3000,
      panelClass: 'error-notification-overlay',
      politeness: 'assertive',
    });
  });
  it('announces asynchronous failures and runs review only on explicit accessible snackbar action', () => {
    const { open, action, service } = setup(),
      review = vi.fn();
    service.error('Modification non enregistrée', { label: 'Revoir', run: review });
    expect(open).toHaveBeenCalledWith('Modification non enregistrée', 'Revoir', {
      duration: 10000,
      panelClass: 'error-notification-overlay',
      politeness: 'assertive',
    });
    expect(review).not.toHaveBeenCalled();
    action.next();
    expect(review).toHaveBeenCalledTimes(1);
  });
});
