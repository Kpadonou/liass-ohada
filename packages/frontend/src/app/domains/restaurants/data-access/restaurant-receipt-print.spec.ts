import { TestBed } from '@angular/core/testing';
import { RestaurantReceiptPrint } from './restaurant-receipt-print';
describe('Native receipt printing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });
  it('prints only a complete temporary document clone and restores DOM without changing source', () => {
    const source = document.createElement('article');
    source.textContent = 'Complete receipt · Total · Settlement';
    document.body.append(source);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const root = document.querySelector('.liass-receipt-print-root');
      expect(root?.textContent).toBe(source.textContent);
      expect(root?.firstChild).not.toBe(source);
      expect(document.body.classList.contains('liass-receipt-printing')).toBe(true);
    });
    TestBed.inject(RestaurantReceiptPrint).print(source);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.liass-receipt-print-root')).toBeNull();
    expect(source.isConnected).toBe(true);
    expect(document.body.classList.contains('liass-receipt-printing')).toBe(false);
    source.remove();
  });
  it('removes print-only DOM even if native print fails', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('Printer unavailable');
    });
    expect(() =>
      TestBed.inject(RestaurantReceiptPrint).print(document.createElement('article')),
    ).toThrow();
    expect(document.querySelector('.liass-receipt-print-root')).toBeNull();
    expect(document.body.classList.contains('liass-receipt-printing')).toBe(false);
  });
});
