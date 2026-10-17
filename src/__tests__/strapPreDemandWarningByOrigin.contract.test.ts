import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSoftStrapPrebaselineNoise } from '@/lib/strapRollCut';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101041800_aviso-pre-demanda-por-origem-da-tira.sql',
);
const engine = read('supabase/migrations/20270101003200_artisanal_straps_operational_engine.sql');

const INTERNAL_WARNING =
  'A versao, o rendimento e a necessidade de base serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.';
const BUY_READY_WARNING =
  'A versao e o consumo desta tira comprada pronta serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.';

describe('aviso de pré-demanda por origem da tira', () => {
  it('o texto de tira interna fica byte a byte igual', () => {
    // Travado em canonicalStrapDemandPreview.test.ts, materialConsumptionReport.test.ts
    // e aggregateStrapNapaSector.test.ts — mudar aqui quebra os três.
    expect(migration).toContain(INTERNAL_WARNING);
  });

  it('tira comprada pronta não fala de rendimento nem de necessidade de base', () => {
    expect(migration).toContain(BUY_READY_WARNING);
    expect(BUY_READY_WARNING).not.toMatch(/rendimento/i);
    expect(BUY_READY_WARNING).not.toMatch(/necessidade de base/i);
  });

  it('a escolha é por source_mode, e só o texto muda', () => {
    expect(migration).toMatch(/CASE WHEN v_source_mode = 'buy_ready'/);
    // A condição do ramo continua sendo "sem demanda corrente": o SELECT que
    // decide segue filtrando is_current, não o texto.
    expect(migration).toContain('AND demand.is_current');
    expect(migration).toContain("'snapshot_source', 'sale_order_item_pre_demand'");
  });

  it('as duas redações continuam SOFT — senão a napa é zerada (bug PV-00222…227)', () => {
    // isSoftStrapPrebaselineNoise casa 'congelad' + 'primeira demanda'. Um texto
    // sem esses tokens faria isArtisanalStrapCutBlocked travar a linha.
    expect(isSoftStrapPrebaselineNoise(INTERNAL_WARNING)).toBe(true);
    expect(isSoftStrapPrebaselineNoise(BUY_READY_WARNING)).toBe(true);
  });

  it('preserva o ramo de SKU acabado sem variante da 20270101031900', () => {
    // O corpo foi copiado da definição VIVA, não do arquivo da 20270101015500 —
    // uma cópia do arquivo antigo perderia este ramo em silêncio.
    expect(migration).toContain('strap_pv_sku_acabado_sem_variante_20270101031900');
    expect(migration).toContain('SKU acabado congelado da tira pronta nao existe mais');
  });

  it('o engine confirma que buy_ready nunca carrega rendimento', () => {
    // É o que justifica a redação nova: o snapshot de rendimento é gravado só
    // para internal, então em buy_ready o campo fica NULL para sempre.
    expect(engine).toContain("CASE WHEN v_source_mode='internal' THEN v_yield ELSE NULL END");
  });

  it('mantém a função fechada para anon e authenticated', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.resolve_committed_strap_identity\([^)]*\)\s*FROM PUBLIC, anon, authenticated, service_role/,
    );
  });
});
