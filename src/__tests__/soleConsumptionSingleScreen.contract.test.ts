import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Consolidação 03/08/2026 — consumo de solado tem UMA tela: Solados → Consumo
 * Padrão (`sole_group_standard_items`, por MODELO).
 *
 * `sole_technical_specs` é ESPELHO, mantido por `tg_sgsi_mirror_papel`. Antes
 * desta data SEIS caminhos gravavam nele por fora e o valor era apagado sem
 * aviso no salvamento seguinte da tela de Consumo Padrão. A tentativa anterior
 * de fechar isso (prop `consumptionReadOnly`) cobria só os <input> — os botões
 * de replicar/copiar e o próprio Salvar seguiam gravando.
 *
 * Este contrato existe porque a guarda de UI é frágil por natureza: qualquer
 * reescrita de tela pode reintroduzir o editor. O banco tem a trava dura
 * (`tg_sole_specs_freeze_consumption`, migration 20261104120000); aqui travamos
 * o lado TS pra o erro aparecer no CI e não em produção.
 */

/** As 8 colunas de consumo do espelho — 4 escalares + 4 mapas por numeração. */
const CONSUMPTION_COLUMNS = [
  'lining_consumption_dm2',
  'insole_consumption_dm2',
  'insole_lining_consumption_dm2',
  'fachete_lining_consumption_dm2',
  'lining_consumption_per_size',
  'insole_consumption_per_size',
  'insole_lining_consumption_per_size',
  'fachete_lining_consumption_per_size',
];

describe('consumo de solado tem uma tela só', () => {
  it('a tela de grade não menciona nenhuma coluna de consumo do espelho', () => {
    const src = read('src/components/technical-sheets/SoleTechnicalDetails.tsx');
    const encontradas = CONSUMPTION_COLUMNS.filter(col => src.includes(col));
    expect(
      encontradas,
      `SoleTechnicalDetails voltou a mexer em consumo (${encontradas.join(', ')}). ` +
      'O cadastro é Solados → Consumo Padrão; esta tela cuida só da grade.',
    ).toEqual([]);
  });

  it('a aba Cadastro não regrava consumo de fachete no espelho', () => {
    const src = read('src/components/soles-hub/SolesCadastroTab.tsx');
    expect(src).not.toMatch(/fachete_lining_consumption_dm2/);
    // O material do fachete CONTINUA aqui — é cadastro do solado, não consumo.
    expect(src).toContain('fachete_material_group_id');
  });

  it('nenhuma tela reintroduz um editor de sole_standard_items_consumption', () => {
    // Tabela aposentada em 07/06/2026; o custeio parou de lê-la na migration
    // 20261104120100. Um editor novo aqui recria a duplicidade num lugar
    // diferente — que foi exatamente como ela sobreviveu duas vezes.
    expect(existsSync(resolve(ROOT, 'src/components/technical-sheets/SoleStandardItemsPanel.tsx'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/hooks/useSoleStandardItems.ts'))).toBe(false);
  });

  it('a página do produto e a de fichas não voltam a montar o editor de solado', () => {
    for (const rel of ['src/pages/ProductDetail.tsx', 'src/pages/ComponentSheets.tsx']) {
      expect(read(rel), `${rel} voltou a montar SoleTechnicalDetails`).not.toContain('SoleTechnicalDetails');
    }
  });

  it('a migration da trava existe e cobre as 8 colunas', () => {
    const mig = read('supabase/migrations/20261104120000_freeze-sole-specs-consumption-mirror.sql');
    expect(mig).toContain('tg_sole_specs_freeze_consumption');
    for (const col of CONSUMPTION_COLUMNS) {
      expect(mig, `a trava não cobre ${col}`).toContain(col);
    }
    // A porta do espelho precisa existir, senão tg_sgsi_mirror_papel se auto-barra.
    expect(mig).toContain("set_config('app.sole_mirror'");
  });
});
