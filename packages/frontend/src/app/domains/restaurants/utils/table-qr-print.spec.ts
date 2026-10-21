import { tableQrPrint } from './table-qr-print';
describe('Printable QR safety', () => {
  it('escapes restaurant/table labels and embeds the high resolution QR without internal identifiers', () => {
    const svg = tableQrPrint(
      'data:image/png;base64,aGVsbG8=',
      ['Bistro & terrasse', '</text><script>alert(1)</script>'],
      'Scan here',
    );
    expect(svg).toContain('Bistro &amp; terrasse');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('width="1024" height="1024"');
    expect(svg).not.toContain('tableId');
  });
  it('keeps long labels inside the printable page', () => {
    const doc = new DOMParser().parseFromString(
      tableQrPrint(
        'data:image/png;base64,aGVsbG8=',
        ['a'.repeat(160), 'b'.repeat(160), 'c'.repeat(160)],
        'Scan',
      ),
      'image/svg+xml',
    );
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(
      Array.from(doc.querySelectorAll('text'))
        .slice(0, -1)
        .every((n) => (n.textContent?.length ?? 0) <= 48),
    ).toBe(true);
    const image = doc.querySelector('image')!,
      lastLabel = Array.from(doc.querySelectorAll('text')).at(-2)!;
    expect(Number(image.getAttribute('y'))).toBeGreaterThan(Number(lastLabel.getAttribute('y')));
  });
});
