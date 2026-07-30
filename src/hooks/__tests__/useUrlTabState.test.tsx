import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useUrlTabState } from '../useUrlTabState';

/**
 * Contrato de deep-link das abas (auditoria de IA, 29/07/2026).
 *
 * O que estes testes travam é o que estava quebrado em 55 dos 62 arquivos com
 * aba: a URL não acompanhava a navegação, então F5 e Voltar devolviam o usuário
 * à primeira aba. E onde havia `localStorage`, ele ganhava do link.
 */

type Tab = 'contas' | 'notas' | 'relatorios';
const VALUES: readonly Tab[] = ['contas', 'notas', 'relatorios'];

let ultimaBusca = '';
let setValueRef: ((v: Tab, o?: { history?: 'push' | 'replace' }) => void) | null = null;

function Sonda(props: Parameters<typeof useUrlTabState<Tab>>[0]) {
  const { value, setValue } = useUrlTabState<Tab>(props);
  const location = useLocation();
  ultimaBusca = location.search;
  setValueRef = setValue;
  return <span data-testid="valor">{value}</span>;
}

function montar(url: string, props: Partial<Parameters<typeof useUrlTabState<Tab>>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Sonda values={VALUES} defaultValue="contas" {...props} />
    </MemoryRouter>,
  );
}

const valor = () => screen.getByTestId('valor').textContent;

beforeEach(() => {
  ultimaBusca = '';
  setValueRef = null;
  window.localStorage.clear();
});

describe('useUrlTabState', () => {
  it('a aba default é a AUSÊNCIA do parâmetro', () => {
    montar('/financeiro');
    expect(valor()).toBe('contas');
    expect(ultimaBusca).toBe('');
  });

  it('selecionar o default LIMPA o parâmetro em vez de escrever ?tab=contas', () => {
    montar('/financeiro?tab=notas');
    act(() => setValueRef!('contas'));
    expect(valor()).toBe('contas');
    expect(ultimaBusca).not.toContain('tab=');
  });

  it('escreve na URL ao trocar de aba — era exatamente isto que faltava', () => {
    montar('/financeiro');
    act(() => setValueRef!('relatorios'));
    expect(ultimaBusca).toContain('tab=relatorios');
  });

  it('normaliza alias para o valor canônico', () => {
    montar('/financeiro?tab=payable', { aliases: { payable: 'contas' as Tab } });
    expect(valor()).toBe('contas');
    // 'contas' é o default → a URL fica limpa.
    expect(ultimaBusca).not.toContain('payable');
  });

  it('valor inválido cai no default e some da URL', () => {
    montar('/financeiro?tab=nao-existe');
    expect(valor()).toBe('contas');
    expect(ultimaBusca).not.toContain('nao-existe');
  });

  it('PRESERVA parâmetros alheios — o modo de falha mais comum da auditoria', () => {
    montar('/financeiro?tab=notas&cliente=abc&de=2026-01-01');
    act(() => setValueRef!('relatorios'));
    expect(ultimaBusca).toContain('cliente=abc');
    expect(ultimaBusca).toContain('de=2026-01-01');
    expect(ultimaBusca).toContain('tab=relatorios');
  });

  it('trocar a aba-pai limpa o filho incompatível', () => {
    montar('/financeiro?tab=notas&subtab=saida', { clearOnChange: ['subtab'] });
    act(() => setValueRef!('relatorios'));
    expect(ultimaBusca).not.toContain('subtab');
  });

  it('absorve parâmetro legado e reescreve como canônico', () => {
    montar('/producao/analises?view=relatorios', { legacyParams: ['view'] });
    expect(valor()).toBe('relatorios');
    expect(ultimaBusca).toContain('tab=relatorios');
    expect(ultimaBusca).not.toContain('view=');
  });

  it('localStorage entra só quando a URL está muda', () => {
    window.localStorage.setItem('financeTab', JSON.stringify('notas'));
    montar('/financeiro', { migrateFrom: 'financeTab' });
    expect(valor()).toBe('notas');
    expect(ultimaBusca).toContain('tab=notas');
  });

  it('a URL GANHA do localStorage — era o inverso disso que quebrava deep-link', () => {
    window.localStorage.setItem('financeTab', JSON.stringify('notas'));
    montar('/financeiro?tab=relatorios', { migrateFrom: 'financeTab' });
    expect(valor()).toBe('relatorios');
  });

  it('valor fora da lista é ignorado no setValue', () => {
    montar('/financeiro');
    act(() => setValueRef!('inventado' as Tab));
    expect(valor()).toBe('contas');
    expect(ultimaBusca).toBe('');
  });
});
