/**
 * updateSentimentFromMessage depende de JOIN com public.chats + public.messages
 * do Omni (schema complexo, +30 colunas NOT NULL). Mockar todo o schema é
 * pesado; rodar com DB real requer chat já existente.
 *
 * Cobertura de updateSentimentFromMessage hoje é validada manualmente via
 * `bun packages/cx-demo/scripts/backfill-sentiment.ts` que reusa a mesma
 * função em todas as conversas reais do DB.
 *
 * TODO: refatorar updateSentimentFromMessage pra aceitar `db` injetado +
 * testar com fake que devolve msgs sem precisar de public.chats real.
 */
import { describe, it } from 'bun:test';

describe.skip('updateSentimentFromMessage — pendente refatoração pra mock', () => {
  it('placeholder', () => {});
});
