import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type BoletoInput = {
  identifier: string; // ex.: 'fatura-2026-06-uuid'
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  plan: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: Date;
};

/**
 * Gera PDF representativo de boleto da Onyx Telecom.
 * Não é boleto bancário real — só layout com valor, vencimento, dados
 * do cliente e um disclaimer claro. Pra demo do agente WhatsApp.
 */
export async function generateBoleto(opts: BoletoInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Boleto Onyx · ${opts.referenceMonth} · ${opts.customerName}`);
  pdf.setSubject('Segunda via demonstrativa');
  pdf.setCreator('Onyx Telecom (Khal demo)');

  const page = pdf.addPage([595, 842]); // A4 retrato
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cyan = rgb(0.0, 0.6, 0.85);
  const dark = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.45, 0.48, 0.55);
  const warnBg = rgb(1.0, 0.96, 0.88);
  const warnBorder = rgb(0.85, 0.62, 0.2);
  const panelBg = rgb(0.96, 0.97, 1.0);
  const panelBorder = rgb(0.85, 0.88, 0.95);

  const reais = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

  // ── Header ──
  page.drawText('ONYX TELECOM', { x: 50, y: 790, font: bold, size: 22, color: cyan });
  page.drawText('Segunda via de fatura', { x: 50, y: 770, font, size: 11, color: muted });
  page.drawText(new Date().toLocaleDateString('pt-BR'), { x: 470, y: 790, font, size: 9, color: muted });

  // ── Aviso ──
  page.drawRectangle({ x: 50, y: 720, width: 495, height: 36, color: warnBg, borderColor: warnBorder, borderWidth: 1 });
  page.drawText('DOCUMENTO MERAMENTE DEMONSTRATIVO', { x: 65, y: 738, font: bold, size: 11, color: rgb(0.55, 0.3, 0.05) });
  page.drawText('Não tem valor fiscal. Gerado para fins de demonstração do produto.', {
    x: 65, y: 725, font, size: 9, color: rgb(0.55, 0.3, 0.05),
  });

  // ── Cliente ──
  page.drawText('CLIENTE', { x: 50, y: 690, font: bold, size: 9, color: muted });
  page.drawText(opts.customerName, { x: 50, y: 672, font: bold, size: 13, color: dark });
  page.drawText(opts.customerPhone, { x: 50, y: 656, font, size: 10, color: muted });
  page.drawText(opts.customerAddress, { x: 50, y: 642, font, size: 9, color: muted });

  page.drawText('PLANO', { x: 350, y: 690, font: bold, size: 9, color: muted });
  page.drawText(opts.plan, { x: 350, y: 672, font: bold, size: 13, color: dark });

  // ── Valor / Vencimento ──
  page.drawRectangle({ x: 50, y: 540, width: 495, height: 90, color: panelBg, borderColor: panelBorder, borderWidth: 1 });
  page.drawText('VALOR', { x: 70, y: 605, font, size: 9, color: muted });
  page.drawText(reais(opts.amountCents), { x: 70, y: 570, font: bold, size: 28, color: dark });

  page.drawText('VENCIMENTO', { x: 320, y: 605, font, size: 9, color: muted });
  page.drawText(opts.dueDate.toLocaleDateString('pt-BR'), { x: 320, y: 570, font: bold, size: 28, color: dark });

  // ── Referência ──
  page.drawText('Referência', { x: 50, y: 505, font, size: 9, color: muted });
  page.drawText(opts.referenceMonth, { x: 50, y: 488, font, size: 11, color: dark });

  page.drawText('Identificador', { x: 250, y: 505, font, size: 9, color: muted });
  page.drawText(opts.identifier, { x: 250, y: 488, font, size: 11, color: dark });

  // ── Código de barras fake ──
  page.drawText('Linha digitável (demonstrativa)', { x: 50, y: 440, font, size: 9, color: muted });
  // Stripes decorativas
  const barY = 410;
  let cursor = 50;
  const seedRand = (s: number) => () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const rnd = seedRand(opts.amountCents + opts.dueDate.getTime());
  while (cursor < 545) {
    const w = 1 + Math.floor(rnd() * 4);
    if (cursor + w > 545) break;
    page.drawRectangle({ x: cursor, y: barY, width: w, height: 32, color: rgb(0.1, 0.12, 0.15) });
    cursor += w + 1 + Math.floor(rnd() * 3);
  }
  // Linha digitável mock
  const codigo = `${String(opts.amountCents).padStart(6, '0')}.${String(opts.dueDate.getTime()).slice(-8)} 23790.16554 01010.000000 8 87770000${String(opts.amountCents).padStart(6, '0')}`;
  page.drawText(codigo, { x: 50, y: 390, font, size: 9, color: rgb(0.2, 0.2, 0.3) });

  // ── Como pagar ──
  page.drawText('COMO PAGAR (DEMO)', { x: 50, y: 340, font: bold, size: 10, color: dark });
  const passos = [
    '1. App da Onyx -> Minhas Faturas -> 2ª via',
    '2. Internet banking -> pagar boleto -> linha digitável acima',
    '3. WhatsApp -> mande "pagar fatura" pra Nova',
  ];
  let py = 320;
  for (const linha of passos) {
    page.drawText(linha, { x: 60, y: py, font, size: 10, color: dark });
    py -= 16;
  }

  // ── Footer ──
  page.drawRectangle({ x: 50, y: 60, width: 495, height: 1, color: panelBorder });
  page.drawText('Onyx Telecom · CNPJ 00.000.000/0001-00 · Av. das Nações 1234, São Paulo/SP', {
    x: 50, y: 45, font, size: 8, color: muted,
  });
  page.drawText('Demonstração — onyxtelecom.com.br · 0800-000-0000', { x: 50, y: 32, font, size: 8, color: muted });

  return await pdf.save();
}
