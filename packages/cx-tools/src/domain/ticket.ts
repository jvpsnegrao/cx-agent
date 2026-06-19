import type { DbClient } from '../db/client.ts';
import { auditLog, tickets } from '@khal/db';

export type TicketProposal = {
  customerId: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
};

export type LinearAdapter = {
  createIssue: (input: TicketProposal & { customerName: string }) => Promise<{ id: string; identifier: string }>;
};

export async function createTicket(
  db: DbClient,
  linear: LinearAdapter,
  proposal: TicketProposal & { customerName: string },
) {
  const issue = await linear.createIssue(proposal);
  const [row] = await db
    .insert(tickets)
    .values({
      customerId: proposal.customerId,
      linearId: issue.identifier,
      title: proposal.title,
      category: proposal.category,
      priority: proposal.priority,
      description: proposal.description,
    })
    .returning();

  if (!row) {
    throw new Error('falha ao registrar ticket no banco');
  }

  await db.insert(auditLog).values({
    customerId: proposal.customerId,
    action: 'abrir_ticket',
    payload: { linearId: issue.identifier, title: proposal.title, priority: proposal.priority },
    result: 'ok',
  });

  return { ticketId: row.id, linearId: issue.identifier };
}
