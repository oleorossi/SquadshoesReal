import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_FLOW_TABS,
  ATELIER_HUB_TABS,
  ATELIER_SUPPORT_TABS,
  ATELIER_TAB_ALIAS,
  resolveAtelierHubTab,
} from '@/components/atelier/AtelierHubChrome';
import { summarizeAtelierHubKpis } from '@/lib/atelierBoard';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('Gestão do Ateliê — UX do módulo único', () => {
  it('preserva todos os deep links e aliases, inclusive na-rua', () => {
    for (const tab of ['planejar', 'corte', 'lancar', 'rua', 'receber', 'prestadores', 'relatorio', 'modelos', 'tiras']) {
      expect(ATELIER_HUB_TABS.has(tab)).toBe(true);
      expect(resolveAtelierHubTab(tab)).toBe(tab);
    }
    expect(ATELIER_TAB_ALIAS['na-rua']).toBe('rua');
    expect(resolveAtelierHubTab('na-rua')).toBe('rua');
    expect(resolveAtelierHubTab('orders')).toBe('rua');
    expect(resolveAtelierHubTab('os-ativas')).toBe('rua');
    expect(resolveAtelierHubTab('planning')).toBe('planejar');
    expect(resolveAtelierHubTab('gestao')).toBe('relatorio');
    expect(resolveAtelierHubTab('prep')).toBe('corte');
    expect(resolveAtelierHubTab('contractors')).toBe('prestadores');
    const hub = read('src/pages/TerceirizadosHub.tsx');
    expect(hub).toContain("raw === 'recipes'");
    expect(hub).toContain('/tiras-artesanais?tab=receitas');
  });

  it('separa o fluxo operacional dos cadastros e relatórios, na ordem do dia a dia', () => {
    expect(ATELIER_FLOW_TABS.map((t) => t.id)).toEqual(['planejar', 'corte', 'lancar', 'rua', 'receber']);
    expect(ATELIER_SUPPORT_TABS.map((t) => t.id)).toEqual(['prestadores', 'modelos', 'tiras', 'relatorio']);
    const chrome = read('src/components/atelier/AtelierHubChrome.tsx');
    expect(chrome).toContain('Fluxo do dia');
    expect(chrome).toContain('Cadastros e relatórios');
    expect(chrome).toContain('inline-flex h-10 min-h-10 shrink-0 items-center gap-2');
  });

  it('breadcrumb sai de RH e vira Produção › Ateliê', () => {
    expect(read('src/data/navigation.ts')).toContain("path: '/terceirizados', label: 'Ateliê', group: 'Produção'");
    expect(read('src/pages/TerceirizadosHub.tsx')).toContain('sectionLabel="PRODUÇÃO · ATELIÊ"');
    expect(read('src/pages/TerceirizadosHub.tsx')).toContain('title="Ateliê"');
  });

  it('o topo tem KPIs acionáveis e a faixa de prazos aponta para o Motor', () => {
    const hub = read('src/pages/TerceirizadosHub.tsx');
    const prazos = read('src/components/atelier/MotorPrazosPanel.tsx');
    const chrome = read('src/components/atelier/AtelierHubChrome.tsx');
    expect(hub).toContain('<AtelierKpiStrip');
    expect(hub).toContain('<MotorPrazosResumo />');
    expect(chrome).toContain('Aguardando corte');
    expect(chrome).toContain('Prontos p/ lançar');
    expect(chrome).toContain('Na rua');
    expect(chrome).toContain('Atrasados');
    expect(chrome).toContain('Pares em andamento');
    expect(prazos).toContain('Ajustar no Motor');
    expect(prazos).toContain('to="/motor?tab=prazos"');
    expect(prazos).not.toMatch(/<Panel className="flex flex-wrap items-center justify-between/);
    expect(summarizeAtelierHubKpis([])).toEqual({
      awaitingCutLots: 0,
      readyToLaunchJobs: 0,
      onStreetJobs: 0,
      toReceiveJobs: 0,
      lateJobs: 0,
      pairsInProgress: 0,
    });
  });

  it('a fila de corte tem busca, badges legíveis e ações primária/secundária separadas', () => {
    const board = read('src/components/atelier/AtelierOperacao.tsx');
    expect(board).toContain('Buscar PV, referência, lote ou prestador');
    expect(board).toContain('md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4');
    expect(board).toContain('Confirmar corte');
    expect(board).toContain('Ver kit');
    expect(board).toContain('Recebimento parcial');
    expect(board).toContain('Confirmar retorno total');
    expect(board).toContain('Ainda não enviado');
    expect(board).toContain('kitShortageBlockMessage');
    expect(board).toContain('rounded-full border px-2 py-0.5 text-xs font-semibold');
  });

  it('a aba Receber e o diálogo registram parcial e retorno total do cabedal', () => {
    const hub = read('src/pages/TerceirizadosHub.tsx');
    const receber = read('src/components/atelier/AtelierReceberPanel.tsx');
    const dialog = read('src/components/atelier/AtelierReceiptDialog.tsx');
    expect(hub).toContain('<AtelierReceberPanel');
    expect(receber).toContain('Recebimento parcial');
    expect(receber).toContain('Confirmar retorno total');
    expect(dialog).toContain('Registrar recebimento parcial');
    expect(dialog).toContain('Confirmar retorno do cabedal');
    expect(dialog).toContain('Saldo a receber');
  });
});
