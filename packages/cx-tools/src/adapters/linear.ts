import { LinearClient } from '@linear/sdk';
import type { LinearAdapter } from '../domain/ticket.ts';

const PRIORITY_MAP = { urgent: 1, high: 2, medium: 3, low: 4 } as const;

export function createLinearAdapter(apiKey: string, teamKey: string): LinearAdapter {
  const client = new LinearClient({ apiKey });

  return {
    async createIssue(input) {
      const teams = await client.teams({ filter: { key: { eq: teamKey } } });
      const team = teams.nodes[0];
      if (!team) throw new Error(`Linear team "${teamKey}" não encontrado`);

      const issue = await client.createIssue({
        teamId: team.id,
        title: `[${input.category}] ${input.title}`,
        description: `**Cliente:** ${input.customerName}\n**Categoria:** ${input.category}\n\n${input.description}`,
        priority: PRIORITY_MAP[input.priority],
      });

      const created = await issue.issue;
      if (!created) throw new Error('Linear não retornou issue criada');
      return { id: created.id, identifier: created.identifier };
    },
  };
}
