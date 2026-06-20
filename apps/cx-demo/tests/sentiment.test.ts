import { describe, expect, it } from 'bun:test';
import { analyzeSentiment } from '../src/sentiment.ts';

describe('analyzeSentiment — urgência', () => {
  it.each([
    'preciso agora urgente',
    'cadê vcs',
    'estou perdendo cliente',
    'preciso já',
    'emergência aqui',
    'cliente perdendo dinheiro',
    '🚨 sem internet há 4h',
  ])('classifica "%s" como urgente', (text) => {
    expect(analyzeSentiment(text)).toBe('urgente');
  });
});

describe('analyzeSentiment — frustração', () => {
  it.each([
    'tô puto da vida',
    'estou bravo',
    'que vacilação',
    'absurdo esse atendimento',
    'ridículo',
    'horrível',
    'que bosta',
    'minha net ta lenta',
    'internet nao funciona',
    'caiu de novo',
    'demorou demais',
    'ta tudo errado',
    'sem sinal',
    'piorou ainda',
    'TÔ MUITO BRAVO',
    'que merda essa internet !!',
    'cancelar agora',
  ])('classifica "%s" como frustrado', (text) => {
    expect(analyzeSentiment(text)).toBe('frustrado');
  });
});

describe('analyzeSentiment — satisfação', () => {
  it.each([
    'obrigado!',
    'valeu mesmo',
    'ótimo atendimento',
    'perfeito',
    'resolveu, obrigado',
    'amei o serviço',
    'funcionou show 👍',
  ])('classifica "%s" como satisfeito', (text) => {
    expect(analyzeSentiment(text)).toBe('satisfeito');
  });
});

describe('analyzeSentiment — neutro', () => {
  it.each([
    'oi',
    'qual minha fatura?',
    'pode confirmar',
    '1',
    'quero a segunda via',
    'tudo bem?',
  ])('classifica "%s" como neutro', (text) => {
    expect(analyzeSentiment(text)).toBe('neutro');
  });
});

describe('analyzeSentiment — edge cases', () => {
  it('string vazia retorna neutro', () => {
    expect(analyzeSentiment('')).toBe('neutro');
  });

  it('string com só espaços retorna neutro', () => {
    expect(analyzeSentiment('   \n\t  ')).toBe('neutro');
  });

  it('frase mista — urgent prevalece sobre angry e happy', () => {
    expect(analyzeSentiment('obrigado mas estou perdendo cliente URGENTE')).toBe('urgente');
  });

  it('frase mista — angry prevalece sobre happy', () => {
    expect(analyzeSentiment('obrigado mas ainda ta ruim')).toBe('frustrado');
  });

  it('só pontuação !!! sozinha = frustrado (ansiedade/irritação implícita)', () => {
    expect(analyzeSentiment('!!!')).toBe('frustrado');
  });
});
