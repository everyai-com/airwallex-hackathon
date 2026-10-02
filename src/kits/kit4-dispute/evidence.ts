/**
 * Minimal PDF writer so evidence uploads work without dependencies.
 * Airwallex accepts JPG or PDF for dispute evidence and rejects PNG, so every
 * generated document is a real, parseable PDF with a text layer.
 */
export function buildPdfEvidence(title: string, lines: string[]): Buffer {
  const escape = (value: string): string => value.replace(/[\\()]/g, (char) => `\\${char}`);
  const stream = [
    'BT /F1 14 Tf 72 740 Td (Airwallex sandbox evidence) Tj ET',
    `BT /F1 12 Tf 72 716 Td (${escape(title)}) Tj ET`,
    ...lines.map(
      (line, index) => `BT /F1 10 Tf 72 ${692 - index * 14} Td (${escape(line)}) Tj ET`,
    ),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
