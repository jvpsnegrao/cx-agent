import type { FC } from 'hono/jsx';
import type { Sentiment } from '../types.ts';

const STYLES: Record<Sentiment, { emoji: string; cls: string; label: string }> = {
  neutro: { emoji: '😐', cls: 'bg-gray-700 text-gray-200', label: 'Neutro' },
  satisfeito: { emoji: '😊', cls: 'bg-green-900/40 text-green-300', label: 'Satisfeito' },
  frustrado: { emoji: '😟', cls: 'bg-amber-900/40 text-amber-300', label: 'Frustrado' },
  urgente: { emoji: '🚨', cls: 'bg-red-900/40 text-red-300', label: 'Urgente' },
};

export const SentimentBadge: FC<{ sentiment: Sentiment }> = ({ sentiment }) => {
  const s = STYLES[sentiment];
  return (
    <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${s.cls}`}>
      <span>{s.emoji}</span> <span>{s.label}</span>
    </span>
  );
};

export const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'open' || status === 'in_progress'
      ? 'bg-cyan-900/40 text-cyan-300'
      : status === 'paid' || status === 'resolved' || status === 'closed'
      ? 'bg-green-900/40 text-green-300'
      : status === 'overdue'
      ? 'bg-red-900/40 text-red-300'
      : 'bg-gray-700 text-gray-200';
  return <span class={`inline-flex px-2 py-0.5 rounded text-xs ${cls}`}>{status}</span>;
};

export const PriorityBadge: FC<{ priority: string }> = ({ priority }) => {
  const cls =
    priority === 'urgent'
      ? 'bg-red-900/40 text-red-300'
      : priority === 'high'
      ? 'bg-amber-900/40 text-amber-300'
      : priority === 'medium'
      ? 'bg-cyan-900/40 text-cyan-300'
      : 'bg-gray-700 text-gray-200';
  return <span class={`inline-flex px-2 py-0.5 rounded text-xs ${cls}`}>{priority}</span>;
};
