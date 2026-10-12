import { describe, it, expect } from 'vitest';
import {
  findTiraSemCor,
  colorIssueBlockerMessage,
} from '@/lib/saleOrderSubmitGuards';
import {
  strapInheritsReferenceNapa,
  strapChoosesReferenceNapa,
} from '@/lib/strapMaterialPolicy';

const colorModeOf = (s: { color_mode?: string | null }) => String(s?.color_mode || 'follow_main');

describe('strapInheritsReferenceNapa — quem depende do servidor pra saber a napa', () => {
  const base = { identity_basis: 'reference_base', material_mode: 'follow_reference' };

  it('inclui follow_main — era ela que ficava SEM fonte no cliente', () => {
    // O bug de 12/10/2026: a consulta `list_reference_strap_napas` só era
    // habilitada para quem ESCOLHE a napa. A linha `follow_main` herda sem
    // escolher, dependia só do preview em lote e, sem ele, a tela afirmava
    // "a ficha não identifica o material-base" numa ficha que o servidor
    // resolve (SP301 → NAPA SOFT).
    expect(strapInheritsReferenceNapa({ ...base, color_mode: 'follow_main' } as never)).toBe(true);
    expect(strapChoosesReferenceNapa({ ...base, color_mode: 'follow_main' } as never)).toBe(false);
  });

  it('quem escolhe também herda — é subconjunto, nunca o contrário', () => {
    const line = { ...base, color_mode: 'select_on_order' } as never;
    expect(strapChoosesReferenceNapa(line)).toBe(true);
    expect(strapInheritsReferenceNapa(line)).toBe(true);
  });

  it('material fixo e lista própria continuam fora — a napa não vem da referência', () => {
    expect(strapInheritsReferenceNapa({
      identity_basis: 'reference_base', material_mode: 'fixed_group', color_mode: 'follow_main',
    } as never)).toBe(false);
    expect(strapInheritsReferenceNapa({
      identity_basis: 'reference_base', material_mode: 'select_on_order', color_mode: 'follow_main',
    } as never)).toBe(false);
  });

  it('tira comprada pronta não herda napa da referência', () => {
    expect(strapInheritsReferenceNapa({
      identity_basis: 'finished_product_group', material_mode: 'follow_reference', color_mode: 'follow_main',
    } as never)).toBe(false);
  });
});

describe('findTiraSemCor — extraído pra o rodapé poder anunciar o mesmo bloqueio', () => {
  const refs = [{ id: 'r1', code: 'SP301', name: 'SP301' }];

  it('tira com texto mas SEM uuid de cor bloqueia — alias não identifica estoque', () => {
    const msg = findTiraSemCor(
      [{ reference_id: 'r1', color: 'ROCHA', strap_colors: [{ color: 'ROCHA', color_id: '', color_mode: 'select_on_order', label: 'FRENTE' }] }],
      refs,
      colorModeOf,
    );
    expect(msg).toContain('Tira sem cor canônica no item 1');
    expect(msg).toContain('FRENTE');
  });

  it('follow_main com cor principal preenchida NÃO bloqueia — a identidade deriva do item', () => {
    expect(findTiraSemCor(
      [{ reference_id: 'r1', color: 'ROCHA', strap_colors: [{ color: '', color_id: '', color_mode: 'follow_main' }] }],
      refs,
      colorModeOf,
    )).toBeNull();
  });

  it('follow_main SEM cor principal volta a bloquear — não há de onde herdar', () => {
    expect(findTiraSemCor(
      [{ reference_id: 'r1', color: '', strap_colors: [{ color: '', color_id: '', color_mode: 'follow_main' }] }],
      refs,
      colorModeOf,
    )).not.toBeNull();
  });

  it('item sem tiras passa', () => {
    expect(findTiraSemCor([{ reference_id: 'r1', color: 'PRETO', strap_colors: [] }], refs, colorModeOf)).toBeNull();
  });
});

describe('colorIssueBlockerMessage — rodapé e toast dizem a MESMA coisa', () => {
  it('cita o componente, não só o nome do grupo', () => {
    // Era o bug relatado: "MATERIAL: NAPA SOFT" ao lado de "sem estoque em NAPA
    // SUDANI" lia-se como troca de material. São componentes diferentes.
    const msg = colorIssueBlockerMessage({ color: 'ROCHA', materials: ['Forração (NAPA SUDANI)'] });
    expect(msg).toContain('Forração (NAPA SUDANI)');
    expect(msg).toContain('ROCHA');
  });

  it('mensagem específica do item vence a genérica', () => {
    expect(colorIssueBlockerMessage({
      color: 'ROCHA', materials: ['Cabedal (NAPA SOFT)'], message: 'texto próprio',
    })).toBe('texto próprio');
  });
});
