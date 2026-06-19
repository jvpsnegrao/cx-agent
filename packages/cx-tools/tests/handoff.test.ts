import { describe, expect, it } from 'bun:test';
import { renderSlackBlocks } from '../src/domain/handoff.ts';

describe('renderSlackBlocks', () => {
  it('inclui sentiment emoji + dados do cliente + últimas msgs', () => {
    const blocks = renderSlackBlocks({
      customerId: 'c1',
      customerName: 'João Silva',
      customerPhone: '+5511999990001',
      customerPlan: 'Pro 50GB',
      conversationId: 'conv1',
      resumo: 'Internet caiu, cliente já abriu chamado, agora quer falar com gente',
      sentiment: 'frustrado',
      lastMessages: ['[customer] internet caiu', '[nova] chamado aberto', '[customer] quero atendente'],
      ticketLinearId: 'ONYX-4471',
    });
    expect(blocks.text).toContain('João Silva');
    const blob = JSON.stringify(blocks.blocks);
    expect(blob).toContain('FRUSTRADO');
    expect(blob).toContain('😟');
    expect(blob).toContain('ONYX-4471');
    expect(blob).toContain('internet caiu');
  });

  it('omite linha do ticket quando não há vínculo', () => {
    const blocks = renderSlackBlocks({
      customerId: 'c1',
      customerName: 'Maria',
      customerPhone: '+5511999990002',
      customerPlan: 'Light 20GB',
      conversationId: 'conv2',
      resumo: 'Dúvida sobre fatura',
      sentiment: 'neutro',
      lastMessages: ['[customer] dúvida'],
    });
    const blob = JSON.stringify(blocks.blocks);
    expect(blob).not.toContain('vinculado');
  });
});
