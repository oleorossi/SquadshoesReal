import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../MaterialVariantsTab.tsx'),
  'utf-8',
);

/**
 * Contrato do diálogo "Nova Variante de Material" (20/08/2026).
 *
 * O modo de falha que estes testes existem pra impedir é o MESMO já documentado
 * no CLAUDE.md para `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`: o componente lê
 * `sheetMaterials?.variant_drives_*`, e com o TS loose uma coluna ausente do
 * `.select()` não vira erro — vira `undefined`. Aqui o sintoma seria pior que
 * um no-op: os três chips apagariam e TODA ficha passaria a exibir o aviso
 * "a ficha não liberou nenhum componente", que é falso.
 */
describe('diálogo de variante · colunas lidas x colunas buscadas', () => {
  /** Todo `sheetMaterials?.<coluna>` lido no componente. Auto-derivado do
   *  próprio fonte, então não desatualiza quando alguém ler uma coluna nova. */
  const colunasLidas = Array.from(
    new Set(
      [...SRC.matchAll(/sheetMaterials\?\.([a-z0-9_]+)/g)].map(m => m[1]),
    ),
  );

  const selectDaFicha = SRC.match(
    /\.from\('technical_sheets'\)\s*\n\s*\.select\('([^']+)'\)/,
  )?.[1];

  it('busca a query da ficha no fonte', () => {
    expect(selectDaFicha, 'o .select() de technical_sheets mudou de forma').toBeTruthy();
  });

  it('toda coluna lida está no .select()', () => {
    expect(colunasLidas.length).toBeGreaterThan(0);
    const buscadas = (selectDaFicha ?? '').split(',').map(c => c.trim());
    for (const coluna of colunasLidas) {
      expect(buscadas, `sheetMaterials.${coluna} é lido mas não é buscado`).toContain(coluna);
    }
  });

  it('lê as 3 flags que alimentam os chips', () => {
    expect(colunasLidas).toContain('variant_drives_upper');
    expect(colunasLidas).toContain('variant_drives_lining');
    expect(colunasLidas).toContain('variant_drives_fachete');
  });

  /**
   * `variant_drives_insole` foi DROPADA (ver `variantMainMaterial.contract.test.ts`).
   * A placa/EVA da palmilha só muda pelo seletor de exceção — um chip "Palmilha"
   * ao lado de Cabedal/Forração/Fachete prometeria um cascateamento que não existe.
   */
  it('não ressuscita a palmilha como componente dirigido pelo material principal', () => {
    // Mira no CÓDIGO, não no fonte inteiro: o comentário do componente cita a
    // coluna dropada de propósito, pra explicar por que ela não está aqui.
    expect(selectDaFicha).not.toContain('variant_drives_insole');
    expect(colunasLidas).not.toContain('variant_drives_insole');
    const blocoChips = SRC.match(/const drivenComponents = useMemo\(\(\) => \(\[[\s\S]*?\]\)/)?.[0] ?? '';
    expect(blocoChips, 'o bloco drivenComponents mudou de forma').toBeTruthy();
    expect(blocoChips).not.toMatch(/Palmilha/i);
  });
});

/**
 * O corpo do diálogo NÃO pode ter scroll próprio: o `DialogContent` do projeto
 * já traz `max-h-[90dvh] overflow-y-auto` (`ui/dialog.tsx`). Os dois juntos
 * criavam contêineres roláveis aninhados — era o que fazia o formulário rolar
 * por dentro de uma janela de 500px numa tela de 1920px.
 */
describe('diálogo de variante · layout', () => {
  const corpoDoDialogo = SRC.match(
    /<DialogContent[\s\S]*?<DialogFooter>/,
  )?.[0] ?? '';

  it('o corpo não reintroduz um segundo scroll', () => {
    expect(corpoDoDialogo).toBeTruthy();
    expect(corpoDoDialogo).not.toMatch(/max-h-\[\d+vh\]\s+overflow-y-auto/);
  });

  it('o diálogo não volta a ser uma coluna estreita', () => {
    expect(SRC).not.toContain('sm:max-w-[500px]');
    expect(corpoDoDialogo).toContain('lg:grid-cols-2');
  });

  /** O pool atravessa 4 setores desde o PR #143 — "napa" exclui GLOW METALIC
   *  ('Componente') na leitura de quem procura. */
  it('o placeholder não volta a falar só de napa', () => {
    expect(SRC).not.toContain('Selecionar grupo de napa');
  });
});
