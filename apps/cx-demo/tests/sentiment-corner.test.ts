import { describe, expect, it } from 'bun:test';
import { analyzeSentiment } from '../src/sentiment.ts';

/**
 * Corner cases — cenários reais de cliente "surtando" ou mudando contexto
 * abruptamente. A heurística é demo-grade mas deve pegar os casos óbvios.
 */

describe('sentiment — cliente surtado', () => {
  it.each([
    'que ódio dessa empresa',
    'já tô com saco cheio',
    'CANCELA TUDO AGORA',
    'esquece, vou na vivo',
    'tô há 3 horas esperando',
    'tô MUITO bravo',
    'isso é um absurdo total',
    'só perde tempo aqui',
    'desisto, vou no rival',
    'putz que coisa errada',
  ])('classifica "%s" como frustrado (ou pior)', (text) => {
    const s = analyzeSentiment(text);
    expect(['frustrado', 'urgente']).toContain(s);
  });
});

describe('sentiment — cliente perdendo tempo/dinheiro (urgente)', () => {
  it.each([
    'tô perdendo cliente por causa disso!!!',
    'preciso agora, emergência aqui',
    'cadê vcs??? URGENTE',
    'preciso da net imediato pra trabalhar',
    'estou perdendo venda',
  ])('classifica "%s" como urgente', (text) => {
    expect(analyzeSentiment(text)).toBe('urgente');
  });
});

describe('sentiment — mudança de assunto súbita', () => {
  it('cliente reclamando + súbito "obrigado" → satisfeito isolado', () => {
    expect(analyzeSentiment('obrigado')).toBe('satisfeito');
  });

  it('cliente frustrado segue frustrado quando palavra de cancelamento aparece', () => {
    expect(analyzeSentiment('cancela tudo aí')).toBe('frustrado');
  });

  it('msg de despedida fria não é satisfeito', () => {
    expect(analyzeSentiment('tchau')).toBe('neutro');
  });
});

describe('sentiment — input não-trivial', () => {
  it('só emoji raivoso = frustrado', () => {
    expect(analyzeSentiment('😡😡😡')).toBe('frustrado');
  });

  it('só emoji feliz = satisfeito', () => {
    expect(analyzeSentiment('🙏❤️')).toBe('satisfeito');
  });

  it('msg muito longa com sinal misto → pega o forte', () => {
    const long =
      'cara, eu tava bem aqui, mas começou a ficar lento ontem, ai testei meu modem e nada funciona !!!';
    expect(analyzeSentiment(long)).toBe('frustrado');
  });

  it('frase ambígua sem palavras-chave = neutro', () => {
    expect(analyzeSentiment('pode confirmar')).toBe('neutro');
  });

  it('número solo (resposta de lista) = neutro', () => {
    expect(analyzeSentiment('1')).toBe('neutro');
    expect(analyzeSentiment('2')).toBe('neutro');
    expect(analyzeSentiment('3')).toBe('neutro');
  });
});

describe('sentiment — cliente xinga atendente / ofensa', () => {
  it.each([
    'que merda essa porra de internet',
    'vocês são uns ladrões',
    'isso é um roubo',
    'são um bando de otários',
  ])('classifica ofensa "%s" como frustrado', (text) => {
    expect(analyzeSentiment(text)).toBe('frustrado');
  });
});

describe('sentiment — cliente mudou endereço/plano no meio (estável neutro)', () => {
  it('mudança de pedido sem emoção = neutro', () => {
    expect(analyzeSentiment('na verdade quero o plano 3')).toBe('neutro');
    expect(analyzeSentiment('meu endereço mudou')).toBe('neutro');
    expect(analyzeSentiment('rua diferente, anota ai')).toBe('neutro');
  });
});
