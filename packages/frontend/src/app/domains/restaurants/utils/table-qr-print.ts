/** Vector page with an embedded 1024px QR; labels remain escaped and wrap at print size. */
export function tableQrPrint(image: string, names: string[], instruction: string): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  const wrap = (value: string) => {
    const chars = Array.from(value.replace(/[\u0000-\u001f]/g, ' '));
    return Array.from({ length: Math.ceil(chars.length / 48) }, (_, i) =>
      chars.slice(i * 48, (i + 1) * 48).join(''),
    );
  };
  const labels = names.filter(Boolean).flatMap(wrap);
  const top = 100 + labels.length * 48,
    height = top + 1180;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="white"/>${labels.map((label, i) => `<text x="600" y="${65 + i * 48}" font-family="sans-serif" font-size="32" text-anchor="middle">${escape(label)}</text>`).join('')}<image href="${image}" x="88" y="${top}" width="1024" height="1024"/><text x="600" y="${top + 1110}" font-family="sans-serif" font-size="28" text-anchor="middle">${escape(instruction)}</text></svg>`;
}
