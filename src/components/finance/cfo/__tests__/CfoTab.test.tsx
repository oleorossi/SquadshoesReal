import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CfoTab from '@/components/finance/cfo/CfoTab';
import CfoOrderDialog from '@/components/finance/cfo/CfoOrderDialog';
import CfoEntryDialog from '@/components/finance/cfo/CfoEntryDialog';
import type { CfoEntry, CfoEntryInput, CfoOrder, CfoOrderInput, CfoPlan } from '@/types/cfo';

const mocks = vi.hoisted(() => ({
  plans: [] as CfoPlan[], orders: [] as CfoOrder[], entries: [] as CfoEntry[],
  permission: { canView: true, canCreate: true, canEdit: true, canDelete: true },
  plansError: null as Error | null,
  saveOrder: vi.fn(), saveEntry: vi.fn(), savePlan: vi.fn(), createEntries: vi.fn(),
  deleteOrder: vi.fn(), deleteEntry: vi.fn(), retryPlans: vi.fn(), retryOrders: vi.fn(), retryEntries: vi.fn(),
}));

vi.mock('@/hooks/useAccessControl', () => ({ useCan: () => mocks.permission }));
vi.mock('@/hooks/useCfo', () => ({
  useCfoPlans: () => ({ data: mocks.plans, error: mocks.plansError, isLoading: false, refetch: mocks.retryPlans }),
  useCfoOrders: () => ({ data: mocks.orders, error: null, isLoading: false, refetch: mocks.retryOrders }),
  useCfoEntries: () => ({ data: mocks.entries, error: null, isLoading: false, refetch: mocks.retryEntries }),
  useCfoSaleOrders: () => ({ data: [], error: null, isLoading: false }),
  useSaveCfoOrder: () => ({ mutateAsync: mocks.saveOrder, isPending: false }),
  useSaveCfoEntry: () => ({ mutateAsync: mocks.saveEntry, isPending: false }),
  useSaveCfoPlan: () => ({ mutateAsync: mocks.savePlan, isPending: false }),
  useCreateCfoEntries: () => ({ mutateAsync: mocks.createEntries, isPending: false }),
  useDeleteCfoOrder: () => ({ mutateAsync: mocks.deleteOrder, isPending: false }),
  useDeleteCfoEntry: () => ({ mutateAsync: mocks.deleteEntry, isPending: false }),
}));

// Medição e desenho SVG são conferidos no navegador; formulários, tabelas e motor são reais.
vi.mock('recharts', async importOriginal => ({
  ...await importOriginal<typeof import('recharts')>(),
  ResponsiveContainer: () => null,
}));

const plan: CfoPlan = {
  id: 'plano-1', nome: 'Projeção setembro', data_inicio: '2026-09-07', data_fim: '2026-09-27',
  saldo_inicial: 0, reserva_minima: 0,
};
const order: CfoOrder = {
  id: 'pedido-1', plano_id: plan.id, pedido_venda_id: null, descricao: 'Pedido da Loja Centro',
  entrega_em: '2026-09-14', lucro_informado: 300, lucro_liquido: true,
  receita_total: 1000, status: 'ativo',
};
const entry: CfoEntry = {
  id: 'material-1', plano_id: plan.id, pedido_id: order.id, tipo: 'material', descricao: 'Napa do pedido',
  data_prevista: '2026-09-08', valor_previsto: 700, data_realizada: null, valor_realizado: null, status: 'previsto',
};

function renderTab(search = '') {
  return render(<MemoryRouter initialEntries={[`/financeiro?tab=cfo${search}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CfoTab /></MemoryRouter>);
}

function metric(label: string) {
  return screen.getByTitle(label).parentElement!.parentElement!;
}

async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('CFO — formulários e acompanhamento', () => {
  beforeAll(() => {
    // Lacuna do jsdom usada pelo foco interno dos Selects Radix.
    if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
    if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false;
    if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};
    if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {};
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plans = [{ ...plan }];
    mocks.orders = [];
    mocks.entries = [];
    mocks.plansError = null;
    mocks.permission = { canView: true, canCreate: true, canEdit: true, canDelete: true };
    mocks.saveOrder.mockImplementation(async (input: CfoOrderInput) => {
      const saved: CfoOrder = { ...input, id: input.id ?? 'novo-pedido' };
      mocks.orders = [...mocks.orders.filter(item => item.id !== saved.id), saved];
      return saved;
    });
    mocks.saveEntry.mockImplementation(async (input: CfoEntryInput) => {
      const saved: CfoEntry = { ...input, id: input.id ?? 'novo-lancamento' };
      mocks.entries = [...mocks.entries.filter(item => item.id !== saved.id), saved];
      return saved;
    });
    mocks.createEntries.mockResolvedValue([]);
  });

  it('cadastra entrega e lucro, mostra o resultado do pedido e mantém caixa sem recebimento em zero', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole('button', { name: 'Projetar pedido' }));
    fireEvent.change(screen.getByLabelText('Pedido / cliente'), { target: { value: 'Pedido Loja Aurora' } });
    fireEvent.change(screen.getByLabelText('Data de entrega'), { target: { value: '2026-09-14' } });
    fireEvent.change(screen.getByLabelText('Lucro total previsto'), { target: { value: '3.000,00' } });
    fireEvent.change(screen.getByLabelText('Valor total a receber do cliente (opcional)'), { target: { value: '10.000,00' } });
    await user.click(screen.getByRole('button', { name: 'Salvar pedido' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.saveOrder).toHaveBeenCalledWith(expect.objectContaining({
      descricao: 'Pedido Loja Aurora', entrega_em: '2026-09-14', lucro_informado: 3000,
      lucro_liquido: true, receita_total: 10000, plano_id: plan.id,
    }));
    const row = await screen.findByRole('row', { name: /Pedido Loja Aurora/ });
    expect(row).toHaveTextContent('14/09/2026');
    expect(row).toHaveTextContent('3.000,00');
    expect(metric('Lucro das entregas')).toHaveTextContent('3.000,00');
    expect(metric('Caixa final projetado')).toHaveTextContent('R$ 0,00');
    expect(screen.getByText(/recebimentos agendados abaixo da receita total/)).toBeInTheDocument();
  });

  it('mantém pedido preenchido quando salvar falha e permite tentar novamente', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    mocks.saveOrder.mockRejectedValueOnce(new Error('Sem conexão'));
    render(<CfoOrderDialog plan={plan} order={order} onClose={onClose} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Lucro total previsto'), { target: { value: '420,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() => expect(mocks.saveOrder).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Lucro total previsto')).toHaveValue('420,50');
    expect(screen.getByLabelText('Pedido / cliente')).toHaveValue(order.descricao);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: order.id, lucro_informado: 420.5 }));
  });

  it('programa despesas semanais em um único lote com datas e valores de cada ocorrência', async () => {
    const onClose = vi.fn();
    render(<CfoEntryDialog plan={plan} orders={[]} entries={[]} initialType="despesa" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Folha semanal' } });
    fireEvent.change(screen.getByLabelText('Data prevista'), { target: { value: '2026-09-08' } });
    fireEvent.change(screen.getByLabelText('Valor previsto'), { target: { value: '5.000,00' } });
    fireEvent.change(screen.getByLabelText('Ocorrências semanais'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Programar 3 semanas' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.createEntries).toHaveBeenCalledOnce();
    expect(mocks.createEntries.mock.calls[0][0]).toEqual([
      expect.objectContaining({ descricao: 'Folha semanal (1/3)', data_prevista: '2026-09-08', valor_previsto: 5000, tipo: 'despesa', pedido_id: null }),
      expect.objectContaining({ descricao: 'Folha semanal (2/3)', data_prevista: '2026-09-15', valor_previsto: 5000, tipo: 'despesa', pedido_id: null }),
      expect.objectContaining({ descricao: 'Folha semanal (3/3)', data_prevista: '2026-09-22', valor_previsto: 5000, tipo: 'despesa', pedido_id: null }),
    ]);
    expect(mocks.saveEntry).not.toHaveBeenCalled();
  });

  it('mantém o modal utilizável com um bilhão de ocorrências e rejeita o lote antes de gravar', async () => {
    const onClose = vi.fn();
    render(<CfoEntryDialog plan={plan} orders={[]} entries={[]} initialType="despesa" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Valor previsto'), { target: { value: '100,00' } });
    fireEvent.change(screen.getByLabelText('Data prevista'), { target: { value: '2026-09-08' } });
    fireEvent.change(screen.getByLabelText('Ocorrências semanais'), { target: { value: '1000000000' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Ocorrências semanais')).toHaveValue(1000000000);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(mocks.createEntries).not.toHaveBeenCalled();
    expect(mocks.saveEntry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Ocorrências semanais'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Programar 2 semanas' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.createEntries.mock.calls[0][0]).toHaveLength(2);
  });

  it('tolera a edição de ano com cinco dígitos sem quebrar a prévia e exige uma data válida para salvar', async () => {
    const onClose = vi.fn();
    render(<CfoEntryDialog plan={plan} orders={[]} entries={[]} initialType="despesa" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Data prevista'), { target: { value: '10000-09-08' } });
    fireEvent.change(screen.getByLabelText('Valor previsto'), { target: { value: '125,00' } });
    expect(screen.getByLabelText('Data prevista')).toHaveValue('10000-09-08');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(mocks.createEntries).not.toHaveBeenCalled();
    expect(mocks.saveEntry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Data prevista'), { target: { value: '2026-09-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ data_prevista: '2026-09-08', valor_previsto: 125 }));
  });

  it('registra pagamento efetivo na mesma linha e troca valor e semana sem somar a previsão novamente', async () => {
    const user = userEvent.setup();
    mocks.orders = [order];
    mocks.entries = [entry];
    renderTab('&cfoView=entries');
    expect(metric('Compras de materiais')).toHaveTextContent('700,00');
    await user.click(screen.getByRole('button', { name: 'Editar lançamento Napa do pedido' }));
    await selectOption('Situação', 'Já pago / recebido');
    fireEvent.change(screen.getByLabelText('Data efetiva'), { target: { value: '2026-09-14' } });
    fireEvent.change(screen.getByLabelText('Valor efetivo'), { target: { value: '650,00' } });
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.saveEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: entry.id, status: 'realizado', data_prevista: '2026-09-08', valor_previsto: 700,
      data_realizada: '2026-09-14', valor_realizado: 650,
    }));
    expect(mocks.entries).toHaveLength(1);
    expect(metric('Compras de materiais')).toHaveTextContent('650,00');
    expect(metric('Caixa final projetado')).toHaveTextContent('-R$ 650,00');
    const row = screen.getByRole('row', { name: /Napa do pedido/ });
    expect(row).toHaveTextContent('14/09/2026');
    expect(row).toHaveTextContent('Realizado');
    await user.click(screen.getByRole('tab', { name: 'Semana a semana' }));
    const firstWeek = await screen.findByRole('row', { name: /07\/09 a 13\/09/ });
    const secondWeek = await screen.findByRole('row', { name: /14\/09 a 20\/09/ });
    expect(within(firstWeek).getAllByRole('cell')[3]).toHaveTextContent('R$ 0,00');
    expect(within(secondWeek).getAllByRole('cell')[3]).toHaveTextContent('R$ 650,00');
  });

  it('sugere apenas o recebimento que falta, usando realizado e ignorando parcela cancelada', async () => {
    const onClose = vi.fn();
    const receipts: CfoEntry[] = [
      { ...entry, id: 'recebido', tipo: 'recebimento', status: 'realizado', valor_previsto: 500, valor_realizado: 200, data_realizada: '2026-09-08' },
      { ...entry, id: 'previsto', tipo: 'recebimento', valor_previsto: 300 },
      { ...entry, id: 'cancelado', tipo: 'recebimento', status: 'cancelado', valor_previsto: 300 },
    ];
    render(<CfoEntryDialog plan={plan} orders={[order]} entries={receipts} initialType="recebimento" initialOrderId={order.id} onClose={onClose} />);
    expect(screen.getByLabelText('Valor previsto')).toHaveValue('500,00');
    expect(screen.getByLabelText('Data prevista')).toHaveValue(order.entrega_em);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'recebimento', pedido_id: order.id, valor_previsto: 500 }));
  });

  it('permite consultar resultados sem expor ações de cadastro, alteração ou exclusão', () => {
    mocks.orders = [order];
    mocks.permission = { canView: true, canCreate: false, canEdit: false, canDelete: false };
    renderTab('&cfoView=orders');
    expect(screen.getByRole('row', { name: /Pedido da Loja Centro/ })).toHaveTextContent('300,00');
    expect(screen.queryByRole('button', { name: 'Projetar pedido' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar pedido/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir pedido/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Material' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recebimento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar semanas' })).toBeEnabled();
  });

  it('mostra falha de consulta sem apresentar números do cache como projeção válida e permite recarregar', () => {
    mocks.orders = [order];
    mocks.entries = [entry];
    mocks.plansError = new Error('Conexão indisponível');
    renderTab();
    expect(screen.getByText('Não foi possível abrir a projeção')).toBeInTheDocument();
    expect(screen.getByText('Conexão indisponível')).toBeInTheDocument();
    expect(screen.queryByTitle('Caixa final projetado')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.retryPlans).toHaveBeenCalledOnce();
    expect(mocks.retryOrders).toHaveBeenCalledOnce();
    expect(mocks.retryEntries).toHaveBeenCalledOnce();
  });
});
