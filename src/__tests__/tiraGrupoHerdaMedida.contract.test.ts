/**
 * Salvamento do PV não pode morrer porque a ficha da tira artesanal não traz
 * group_id. Família + medida resolvem o grupo de estoque (mapa do Hub, grupo
 * TIPO NMM já existente, ou grupo novo). A cor ausente na napa continua
 * barrada. O gatilho da 45800 permanece: SKU sem grupo ainda é inválido.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101050300_tira_grupo_herda_medida.sql',
), 'utf8');
const gate = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101045800_overlock-tira3-fonte-unica-rendimento.sql',
), 'utf8');

describe('tira artesanal herda o grupo da medida no save do PV', () => {
  it('resolve pelo mapa e, na falta, cria o grupo TIPO NMM de Material Base', () => {
    expect(migration).toContain('heranca_grupo_tira_20270101050300');
    expect(migration).toContain('private.ensure_strap_measure_stock_group');
    expect(migration).toContain('strap_hub_measure_group_map');
    expect(migration).toContain("sector");
    expect(migration).toContain("'Material Base'");
    expect(migration).toContain('is_artisanal_strap');
    expect(migration).toContain("|| 'MM'");
    expect(migration).toContain('ON CONFLICT (measure_id) DO NOTHING');
    expect(migration).toContain('WHERE lower(btrim(g.name)) = lower(v_name)');
  });

  it('o writer interno preenche group_id e a napa-base antes do INSERT', () => {
    expect(migration).toContain('IF v_product_group_id IS NULL THEN');
    expect(migration).toContain(
      'v_product_group_id := private.ensure_strap_measure_stock_group(v_measure_id);',
    );
    expect(migration).toContain('group_id, strap_base_group_id, color');
    expect(migration).toContain('v_product_group_id, v_base_group_id, v_color.name');
  });

  it('o writer legado do Hub usa a mesma resolução em vez do mapa vazio', () => {
    expect(migration).toContain(
      'save_artisanal_strap_catalog_bundle_reference_base_legacy',
    );
    expect(migration).toContain(
      'private.ensure_strap_measure_stock_group(v_measure_id),',
    );
  });

  it('cor ausente na napa continua barrada e o gatilho sem grupo permanece', () => {
    expect(migration).toContain('Nao existe % % ativo no estoque');
    expect(gate).toContain('O writer legado sem grupo está bloqueado.');
    expect(migration).not.toContain('DROP TRIGGER');
  });
});
