import { renderSlackBlocks } from '../domain/handoff.ts';
import type { SlackAdapter } from '../domain/handoff.ts';

export function createSlackAdapter(webhookUrl: string): SlackAdapter {
  return {
    async postHandoff(payload) {
      const body = renderSlackBlocks(payload);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
      }
    },
  };
}
