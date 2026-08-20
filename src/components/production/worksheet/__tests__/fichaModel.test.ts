import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTOR_LABELS } from '@/lib/sectors';
import {
  FICHA_MODEL_BY_SECTOR,
  fichaModelFor,
  showsFlowRail,
  showsQr,
  showsTrace,
} from '../fichaModel';

const src = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src/components/production', file), 'utf8');

describe('modelo de informação da ficha de operador', () => {
  it('trava a escolha do dono na rodada 1 (20/08/2026)', () => {
    expect(fichaModelFor('Montagem')).toBe('lote');
    expect(fichaModelFor('Corte Palmilha')).toBe('lote');
    expect(fichaModelFor('Solagem')).toBe('lote');
    expect(fichaModelFor('Silk')).toBe('mao');
  });

  // A ficha da Expedição não entrou na rodada 1 — a escolha entre E1/E2/E3
  // (pedido replicado em várias lojas) segue aberta. Promovê-la "por coerência"
  // mudaria a folha que a bancada confere sem ninguém ter decidido.
  it('mantém a Expedição em legacy até a escolha E1/E2/E3', () => {
    expect(fichaModelFor('Expedição')).toBe('legacy');
  });

  // Os componentes servem vários setores cada um; quem não foi decidido não
  // pode mudar de aparência de carona.
  it('não mexe em setor que ficou de fora', () => {
    for (const sector of ['Acabamento', 'Colagem', 'Corte Forração', 'Corte Cabedal',
      'Costura Palmilha', 'Costura Cabedal', 'Aviamento']) {
      expect(fichaModelFor(sector)).toBe('legacy');
    }
  });

  it('cai em legacy — nunca quebra — com setor desconhecido, vazio ou nulo', () => {
    expect(fichaModelFor('Setor Que Não Existe')).toBe('legacy');
    expect(fichaModelFor('')).toBe('legacy');
    expect(fichaModelFor(null)).toBe('legacy');
    expect(fichaModelFor(undefined)).toBe('legacy');
  });

  it('dá ao modelo os cortes que cada um prometeu', () => {
    // 'lote': sem trilho nem índice editorial, mas mantém QR e rastreio.
    expect(showsFlowRail('lote')).toBe(false);
    expect(showsQr('lote')).toBe(true);
    expect(showsTrace('lote')).toBe(true);
    // 'mao': corta também o QR e o rastreio inteiro.
    expect(showsFlowRail('mao')).toBe(false);
    expect(showsQr('mao')).toBe(false);
    expect(showsTrace('mao')).toBe(false);
    // 'legacy': nada muda.
    expect(showsFlowRail('legacy')).toBe(true);
    expect(showsQr('legacy')).toBe(true);
    expect(showsTrace('legacy')).toBe(true);
  });
});

/**
 * Uma grafia errada no mapa NÃO quebra nada: cai em 'legacy' e o setor
 * simplesmente não muda, em silêncio. Estes testes existem porque esse é o
 * modo de falha — invisível — e o repo tem DUAS convenções vivas para o corte
 * de palmilha ('Corte Fibra' em `SECTOR_LABELS`, 'Corte Palmilha' na tela de
 * impressão), que é exatamente onde um typo passaria despercebido.
 */
describe('as chaves do mapa batem com o que o app realmente passa', () => {
  it('usa a grafia canônica nos setores que têm uma só', () => {
    const canonical = new Set(Object.values(SECTOR_LABELS));
    for (const sector of ['Montagem', 'Solagem', 'Silk']) {
      expect(FICHA_MODEL_BY_SECTOR[sector]).toBeDefined();
      expect(canonical.has(sector)).toBe(true);
    }
  });

  it('usa, no corte de palmilha, a MESMA string que a ficha passa', () => {
    // A ficha chama `fichaModelFor('Corte Palmilha')` com literal — se alguém
    // trocar por 'Corte Fibra' de um lado só, o modelo vira no-op.
    const literals = Array.from(
      src('PalmilhaWorkSheet.tsx').matchAll(/fichaModelFor\(\s*'([^']+)'\s*\)/g),
      (m) => m[1],
    );
    expect(literals).toHaveLength(1);
    expect(FICHA_MODEL_BY_SECTOR[literals[0]]).toBe('lote');
  });

  it('mantém as fichas decididas lendo o modelo do mapa, não de um literal solto', () => {
    // Montagem, Solagem e Silk derivam do próprio `sector` do componente.
    for (const file of ['OperatorWorkSheet.tsx', 'SolagemWorkSheet.tsx', 'SilkMontageWorkSheet.tsx']) {
      expect(src(file)).toMatch(/fichaModelFor\(sector\)/);
    }
  });

  // A Expedição não importa o mapa — não há como ela mudar de modelo por engano.
  it('deixa a ExpedicaoWorkSheet fora do mapa por completo', () => {
    expect(src('ExpedicaoWorkSheet.tsx')).not.toMatch(/fichaModel/);
  });
});
