import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DREAuto } from '@/components/finance/DREAuto';
import { SmartDashboard } from '@/components/finance/SmartDashboard';
import type { DREMonth, DREReport } from '@/hooks/useFinanceIntelligence';

const mocks = vi.hoisted(() => ({
  dre: vi.fn(), inventory: vi.fn(), kpis: vi.fn(), alerts: vi.fn(), projection: vi.fn(),
  refetchDre: vi.fn(), refetchKpis: vi.fn(), refetchProjection: vi.fn(), refetchInventory: vi.fn(),
}));
vi.mock('@/hooks/useFinanceIntelligence', () => ({
  useDREAuto: mocks.dre, useDREInventoryVariation: mocks.inventory, useFinanceKPIs: mocks.kpis,
  useFinanceAlerts: mocks.alerts, useCashFlowProjection: mocks.projection,
}));
vi.mock('@/components/ui/stat-number', () => ({ StatNumber: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: () => <div data-testid="chart" />, LineChart: () => <div data-testid="chart" />, AreaChart: () => <div data-testid="chart" />,
  Bar: () => null, Line: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null, ReferenceLine: () => null,
}));

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const month = (period: string, patch: Partial<DREMonth> = {}): DREMonth => ({
  period, receita: 1000, cmv: 600, margemBruta: 400, margemBrutaPct: 40,
  despOperacionais: 100, ebitda: 300, ebitdaPct: 30, impostos: 20, jurosFactoring: 10,
  resultadoLiquido: 270, resultadoLiquidoPct: 27, ...patch,
});
let report: DREReport;
let kpis: {
  totalBalance: number; bankAccountsCount: number; totalPayable: number; totalReceivable: number;
  netPosition: number; monthRevenue: number; monthExpenses: number; monthResult: number;
  monthReceivableForecast: number; monthPayableForecast: number; monthForecastResult: number; revenueGrowth: number;
  cashWarnings: { legacyDatedCount: number; undatedLegacyCount: number; undatedReceipts: number; undatedPayments: number };
};

function renderDre() { return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DREAuto /></MemoryRouter>); }
function hideDreNumbers() {
  expect(screen.queryByText('Receita Total')).not.toBeInTheDocument();
  expect(screen.queryByText('EBITDA Acumulado')).not.toBeInTheDocument();
  expect(screen.queryByText('Quanto do faturamento foi pro bolso')).not.toBeInTheDocument();
  expect(screen.queryByText('Detalhamento Mensal')).not.toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  report = {
    months: [month('2026-08'), month('2026-09'), month('2026-10')],
    company: { regime_tributario: '3', razao_social: 'Empresa de teste' },
    origemVazia: { recebimentos: false, pagamentos: false, cmv: false },
    cashWarnings: { legacyDatedCount: 0, undatedLegacyCount: 0, undatedReceipts: 0, undatedPayments: 0, undatedCmv: 0 },
    hasFactoringMovements: false,
    cmvPending: [],
  };
  kpis = {
    totalBalance: 100, bankAccountsCount: 1, totalPayable: 220, totalReceivable: 300, netPosition: 180,
    monthRevenue: -300, monthExpenses: -120, monthResult: -180, monthReceivableForecast: 350,
    monthPayableForecast: 240, monthForecastResult: 110, revenueGrowth: 0,
    cashWarnings: { legacyDatedCount: 0, undatedLegacyCount: 0, undatedReceipts: 0, undatedPayments: 0 },
  };
  mocks.dre.mockImplementation(() => ({ data: report, isLoading: false, error: null, refetch: mocks.refetchDre }));
  mocks.inventory.mockReturnValue({ data: [], isLoading: false, error: null, refetch: mocks.refetchInventory });
  mocks.kpis.mockImplementation(() => ({ data: kpis, isLoading: false, error: null, refetch: mocks.refetchKpis }));
  mocks.alerts.mockReturnValue({ data: [], isLoading: false, error: null });
  mocks.projection.mockReturnValue({ data: { series: [], firstNegativeDay: null }, isLoading: false, error: null, refetch: mocks.refetchProjection });
});

describe('DRE — avisos e bloqueios da apuração de caixa', () => {
  it('mantém aviso de legado sem data mesmo quando não há nenhum movimento datado', () => {
    report.months = [];
    report.origemVazia = { recebimentos: true, pagamentos: true, cmv: true };
    report.cashWarnings = { legacyDatedCount: 0, undatedLegacyCount: 3, undatedReceipts: 250, undatedPayments: 100, undatedCmv: 150 };
    renderDre();
    expect(screen.getByText('Sem lançamentos no período')).toBeInTheDocument();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(`recebimentos ${money(250)}, pagamentos ${money(100)} e CMV ${money(150)}`);
    expect(warning).toHaveTextContent('A apuração é incompleta');
    hideDreNumbers();
  });

  it('identifica datas antigas sem ocultar movimentos datados válidos', () => {
    report.cashWarnings.legacyDatedCount = 2;
    renderDre();
    expect(screen.getByRole('alert')).toHaveTextContent('2 valor(es) antigo(s) usa(m) a data que já estava registrada');
    expect(screen.getByText('Receita Total')).toBeInTheDocument();
    expect(screen.getByText('Detalhamento Mensal')).toBeInTheDocument();
  });

  it('não oculta prejuízo quando a única movimentação do período é despesa de factoring', () => {
    report.months = [month('2026-10', { receita: 0, cmv: 0, margemBruta: 0, margemBrutaPct: 0,
      despOperacionais: 0, ebitda: 0, ebitdaPct: 0, impostos: 0, jurosFactoring: 50,
      resultadoLiquido: -50, resultadoLiquidoPct: 0 })];
    report.origemVazia = { recebimentos: true, pagamentos: true, cmv: true };
    report.hasFactoringMovements = true;
    renderDre();
    expect(screen.queryByText('Sem lançamentos no período')).not.toBeInTheDocument();
    expect(screen.getByText('Detalhamento Mensal')).toBeInTheDocument();
    const october = screen.getByText('out/26').closest('tr')!;
    expect(within(october).getByText(money(50))).toBeInTheDocument();
    expect(within(october).getByText(money(-50))).toBeInTheDocument();
  });

  it('não cria alerta legado quando todos os eventos têm origem discriminada', () => {
    renderDre();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Quanto do faturamento foi pro bolso')).toBeInTheDocument();
  });

  it('bloqueia lucro e gráficos se houver recebimento sem custo, mantendo avisos e ações', () => {
    report.cashWarnings.undatedLegacyCount = 1;
    report.cashWarnings.undatedReceipts = 250;
    report.cmvPending = [{ id: 'evento', receivable_id: 'ar', sale_order_id: 'pv', effective_on: '2026-09-10', received_amount: 700 }];
    renderDre();
    expect(screen.getByText('Apuração incompleta: movimentos com custo pendente')).toBeInTheDocument();
    expect(screen.getByText(/não serão apresentados como lucro com custo zero/)).toBeInTheDocument();
    expect(screen.getByText('Histórico anterior sem discriminação completa')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar vendas' })).toHaveAttribute('href', '/sales');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar apuração' }));
    expect(mocks.refetchDre).toHaveBeenCalledOnce();
    expect(mocks.inventory).toHaveBeenCalledWith(6, false);
    fireEvent.click(screen.getByRole('button', { name: '3 meses' }));
    expect(mocks.dre).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole('button', { name: '3 meses' })).toHaveAttribute('aria-pressed', 'true');
    hideDreNumbers();
  });

  it('não descreve um estorno pendente como um novo recebimento', () => {
    report.cmvPending = [{ id: 'estorno', receivable_id: 'ar', sale_order_id: 'pv', effective_on: '2026-09-10', received_amount: -700 }];
    renderDre();
    expect(screen.getByText(/incluindo recebimentos, estornos ou saldos anteriores/)).toBeInTheDocument();
    hideDreNumbers();
  });

  it('uma falha de atualização esconde também resultados antigos em cache e permite nova consulta', () => {
    mocks.dre.mockReturnValue({ data: report, isLoading: false, error: new Error('CMV indisponível'), refetch: mocks.refetchDre });
    renderDre();
    expect(screen.getByText('Não foi possível calcular a DRE')).toBeInTheDocument();
    expect(screen.getByText('CMV indisponível')).toBeInTheDocument();
    expect(mocks.inventory).toHaveBeenCalledWith(6, false);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetchDre).toHaveBeenCalledOnce();
    hideDreNumbers();
  });

  it('preserva os sinais de estorno na linha do mês sem apagar agosto e setembro', () => {
    report.months[2] = month('2026-10', { receita: -300, cmv: -180, margemBruta: -120, despOperacionais: -120, ebitda: 0, impostos: 0, jurosFactoring: 0, resultadoLiquido: 0 });
    renderDre();
    const october = screen.getByText('out/26').closest('tr')!;
    expect(within(october).getByText(money(-300))).toBeInTheDocument();
    expect(within(october).getByText(money(-180))).toBeInTheDocument();
    expect(screen.getByText('ago/26')).toBeInTheDocument();
    expect(screen.getByText('set/26')).toBeInTheDocument();
  });

  it('aplica mudança de janela aos dois relatórios sem misturar suas fontes', () => {
    renderDre();
    fireEvent.click(screen.getByRole('button', { name: '3 meses' }));
    expect(mocks.dre).toHaveBeenLastCalledWith(3);
    expect(mocks.inventory).toHaveBeenLastCalledWith(3, true);
  });
});

describe('visão financeira — realizado, previsão e fontes incompletas', () => {
  it('mantém alerta de legado sem data mesmo se todos os totais mensais forem zero', () => {
    kpis.monthRevenue = 0; kpis.monthExpenses = 0; kpis.monthResult = 0;
    kpis.cashWarnings = { legacyDatedCount: 0, undatedLegacyCount: 2, undatedReceipts: 250, undatedPayments: 100 };
    render(<SmartDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent(`Sem data comprovada e fora dos totais mensais: recebimentos ${money(250)} e pagamentos ${money(100)}`);
    expect(screen.getByText('Movimento realizado no mês')).toBeInTheDocument();
  });

  it('expõe a quantidade de valores antigos que usam data anterior registrada', () => {
    kpis.cashWarnings.legacyDatedCount = 4;
    render(<SmartDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent('4 valor(es) usa(m) a data antiga registrada');
  });

  it('separa caixa realizado negativo de previsão ainda em aberto e alerta sobre saldo bancário', () => {
    render(<SmartDashboard />);
    expect(screen.getByText(money(-300))).toBeInTheDocument();
    expect(screen.getByText(money(-120))).toBeInTheDocument();
    expect(screen.getByText(money(-180))).toBeInTheDocument();
    expect(screen.getByText(`Ainda previsto no mês: ${money(350)}`)).toBeInTheDocument();
    expect(screen.getByText(`Ainda previsto no mês: ${money(240)}`)).toBeInTheDocument();
    expect(screen.getByText(`Resultado ainda previsto: ${money(110)}`)).toBeInTheDocument();
    expect(screen.getByText('Baixas de títulos não atualizam este saldo automaticamente.')).toBeInTheDocument();
  });

  it('erro de qualquer fonte do KPI esconde os totais em cache e oferece nova consulta', () => {
    mocks.kpis.mockReturnValue({ data: kpis, isLoading: false, error: new Error('Página de títulos indisponível'), refetch: mocks.refetchKpis });
    render(<SmartDashboard />);
    expect(screen.getByText('Não foi possível montar a visão financeira')).toBeInTheDocument();
    expect(screen.getByText('Nenhum total será exibido com fontes incompletas.')).toBeInTheDocument();
    expect(screen.queryByText('Movimento realizado no mês')).not.toBeInTheDocument();
    expect(screen.queryByText('Saldo cadastrado em bancos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetchKpis).toHaveBeenCalledOnce();
  });

  it('falha de alertas não vira mensagem de tudo em dia', () => {
    mocks.alerts.mockReturnValue({ data: [], isLoading: false, error: new Error('Alertas indisponíveis') });
    render(<SmartDashboard />);
    expect(screen.getByText('Falha ao carregar alertas')).toBeInTheDocument();
    expect(screen.queryByText('Tudo em dia')).not.toBeInTheDocument();
    expect(screen.getByText('Movimento realizado no mês')).toBeInTheDocument();
  });

  it('falha na projeção oculta o gráfico sem apagar o caixa realizado confirmado', () => {
    mocks.projection.mockReturnValue({ data: { series: [{ date: '2026-10-20', balance: 999999 }], firstNegativeDay: null }, isLoading: false, error: new Error('Projeção indisponível'), refetch: mocks.refetchProjection });
    render(<SmartDashboard />);
    expect(screen.getByText('Falha ao carregar a projeção')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.getByText(money(-300))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetchProjection).toHaveBeenCalledOnce();
  });
});
