import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { PendingChangesService } from './pending-changes.service';

describe('PendingChangesService', () => {
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        PendingChangesService,
        { provide: MatDialog, useValue: { open } }
      ]
    });
  });

  it('allows navigation without prompting when the form is pristine', async () => {
    const service = TestBed.inject(PendingChangesService);
    await expect(service.confirmDeparture()).resolves.toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('protects a dirty draft and honors the user decision', async () => {
    open.mockReturnValue({ afterClosed: () => of(false) });
    const service = TestBed.inject(PendingChangesService);
    service.setPendingChanges(true);

    await expect(service.confirmDeparture()).resolves.toBe(false);
    expect(open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disableClose: true, restoreFocus: true })
    );
  });
});
