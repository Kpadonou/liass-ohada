import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AccountingApi } from './accounting.api';
import { AccountingQueries, accountingQueryKeys } from './accounting-queries';

describe('AccountingQueries', () => {
  let accountingApi: {
    getAccount: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
  };
  let queries: AccountingQueries;

  beforeEach(() => {
    accountingApi = {
      getAccount: vi.fn(),
      listAccounts: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        AccountingQueries,
        { provide: AccountingApi, useValue: accountingApi }
      ]
    });

    queries = TestBed.inject(AccountingQueries);
  });

  it('keeps stable account query keys and typed query functions', async () => {
    accountingApi.listAccounts.mockResolvedValue({ items: [], hasMore: false });
    accountingApi.getAccount.mockResolvedValue({ accountId: '41100000' });

    const listOptions = queries.listAccounts({ limit: 25 });
    const detailOptions = queries.account('41100000');

    expect(accountingQueryKeys.accounts).toEqual(['accounting', 'accounts']);
    expect(accountingQueryKeys.account('41100000')).toEqual([
      'accounting',
      'accounts',
      '41100000'
    ]);
    expect(listOptions.queryKey).toEqual(['accounting', 'accounts']);
    expect(detailOptions.queryKey).toEqual(['accounting', 'accounts', '41100000']);
    expect(detailOptions.enabled).toBe(true);

    await (listOptions.queryFn as () => Promise<unknown>)();
    await (detailOptions.queryFn as () => Promise<unknown>)();

    expect(accountingApi.listAccounts).toHaveBeenCalledWith({ limit: 25 });
    expect(accountingApi.getAccount).toHaveBeenCalledWith('41100000');
  });

  it('disables account detail queries for invalid account ids', () => {
    expect(queries.account('ABC').enabled).toBe(false);
  });
});
