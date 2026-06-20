import type { FC } from 'hono/jsx';
import { Shell } from './Shell.tsx';
import { StatusBadge } from '../components/SentimentBadge.tsx';

export type FaturaRow = {
  id: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: Date;
  status: 'open' | 'paid' | 'overdue';
  pdfUrl: string | null;
  customerName: string;
  customerPhone: string;
};

const reais = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const Faturas: FC<{ rows: FaturaRow[] }> = ({ rows }) => (
  <Shell title="Faturas" activeTab="faturas">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-semibold">Faturas</h2>
        <p class="text-sm text-gray-400">{rows.length} boletos no DB.</p>
      </div>
    </div>
    <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {rows.length === 0 ? (
        <div class="px-4 py-8 text-center text-gray-500 text-sm">Nenhuma fatura.</div>
      ) : (
        <table class="w-full text-sm">
          <thead class="bg-gray-800/50 text-gray-400">
            <tr>
              <th class="px-4 py-2 text-left font-medium">Ref</th>
              <th class="px-4 py-2 text-left font-medium">Cliente</th>
              <th class="px-4 py-2 text-left font-medium">Valor</th>
              <th class="px-4 py-2 text-left font-medium">Vencimento</th>
              <th class="px-4 py-2 text-left font-medium">Status</th>
              <th class="px-4 py-2 text-left font-medium">2ª via</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="px-4 py-2 font-mono text-gray-300 text-xs">{f.referenceMonth}</td>
                <td class="px-4 py-2">
                  {f.customerName}
                  <div class="text-xs text-gray-500">{f.customerPhone}</div>
                </td>
                <td class="px-4 py-2">{reais(f.amountCents)}</td>
                <td class="px-4 py-2">{fmtDate(f.dueDate)}</td>
                <td class="px-4 py-2"><StatusBadge status={f.status} /></td>
                <td class="px-4 py-2">
                  {f.pdfUrl ? (
                    <a href={f.pdfUrl} target="_blank" rel="noopener noreferrer" class="text-cyan-400 text-xs hover:underline">
                      ↗ link
                    </a>
                  ) : (
                    <span class="text-gray-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Shell>
);
