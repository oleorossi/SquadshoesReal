// Pagamento da produção direto da Ficha de Montadores.
//
// A tela é de produção, mas o REGISTRO continua sendo a folha: este hook cria a
// `payroll_runs` da janela e a aprova. Nada de livro paralelo — recibo,
// adiantamento, holerite e custo de mão de obra no DRE leem payroll_runs /
// payroll_payments, e um segundo lugar de verdade quebraria os quatro.
//
// ⚠ A SEQUÊNCIA É LOAD-BEARING: INSERT como 'rascunho', depois UPDATE para
// 'aprovado'. `tg_ficha_claim_production` é BEFORE **UPDATE** OF status — uma
// folha inserida já aprovada NÃO dispara o gatilho: a produção não é
// reivindicada, o bruto não é reescrito e os lançamentos ficam em aberto para
// sempre, sem nada na tela indicando isso. O mesmo vale para
// `trg_payroll_link_advances_and_overtime`, que desconta os adiantamentos.
//
// Por isso o valor a pagar é lido do banco DEPOIS da aprovação, e não calculado
// aqui: os gatilhos reescrevem bruto e líquido. Se outra folha já era dona de
// alguns dias, ou se havia adiantamento na janela, o número muda — e o que vale
// é o que o banco reivindicou, não o que a tela somou antes.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Período de folha no formato de intervalo (`payroll_period_range` entende).
 *
 *  ⚠ O formato é contrato com o BANCO, não estilo: `payroll_period_range`,
 *  `tg_payroll_link_advances_and_overtime` e `tg_payroll_block_period_overlap`
 *  casam `^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$`. Trocar o separador faz os três
 *  caírem no ramo "formato desconhecido" — o de adiantamentos levanta exceção, e
 *  o de reivindicação simplesmente NÃO reivindica, em silêncio. */
export const periodoDeJanela = (from: string, to: string) => `${from}_${to}`;

/** Regex que o banco usa para reconhecer a janela. Exportado para o teste poder
 *  travar o contrato sem reescrever o padrão (duas cópias divergiriam). */
export const PERIODO_JANELA_RE = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/;

const isoDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Semana de pagamento de montador e solador: **segunda a domingo** (decisão do
 * dono, 07/08/2026).
 *
 * O domingo entra de propósito. Já há produção lançada em fim de semana no
 * histórico, e uma semana que terminasse no sábado deixaria esses pares órfãos —
 * sem folha nenhuma que os cobrisse, invisíveis para sempre.
 *
 * Semanas consecutivas são ADJACENTES, nunca sobrepostas: a de seg X termina no
 * domingo, e a próxima começa na segunda seguinte. Isso é o que permite pagar
 * semana após semana sem esbarrar em `tg_payroll_block_period_overlap`.
 */
export function semanaDePagamento(iso: string): { from: string; to: string } {
  const base = new Date(`${iso}T00:00:00`);
  const dow = (base.getDay() + 6) % 7; // 0 = segunda … 6 = domingo
  const seg = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dow);
  const dom = new Date(base.getFullYear(), base.getMonth(), base.getDate() - dow + 6);
  return { from: isoDe(seg), to: isoDe(dom) };
}

export interface AbrirFolhaProducaoInput {
  employeeId: string;
  /** Janela inclusiva, ISO. Na cadência semanal: segunda → domingo. */
  from: string;
  to: string;
}

export interface FolhaProducaoAberta {
  runId: string;
  period: string;
  /** Bruto REIVINDICADO pela folha — pode ser menor que o exibido na tela se
   *  outra folha já era dona de algum dia da janela. */
  bruto: number;
  /** Adiantamentos da janela que o gatilho descontou. */
  descontos: number;
  /** O que efetivamente se paga. É este o valor que vai para o recibo. */
  liquido: number;
  /** Avisos que o gatilho anexou (dias em conflito, lançamentos sem R$/par). */
  notes: string;
}

interface RunRow {
  id: string;
  period: string;
  status: string;
  total_proventos: number | string | null;
  total_descontos: number | string | null;
  total_liquido: number | string | null;
  notes: string | null;
}

const num = (v: number | string | null | undefined) => Number(v) || 0;

/** Mensagem de erro do banco → texto que o usuário do chão de fábrica entende. */
function traduzErro(msg: string): string {
  if (/Já existe folha desta pessoa/i.test(msg)) return msg;
  if (/duplicate key|payroll_runs_employee_id_period_key|uq_payroll_runs_active_employee_period/i.test(msg)) {
    return 'Já existe uma folha desta pessoa exatamente neste período.';
  }
  return msg;
}

/**
 * A janela é uma SEMANA FECHADA (segunda + 6 dias)?
 *
 * Portão do pagamento: a cadência é semanal, e pagar uma janela maior (quinzena,
 * mês, intervalo solto) reivindicaria de uma vez os dias de TODAS as semanas
 * dentro dela — e `tg_payroll_block_period_overlap` passaria a recusar cada
 * semanal daquele intervalo, para sempre. Fica-se preso a uma folha só.
 *
 * Validado pelo VALOR das datas, não pelo preset clicado: digitar 15/06–21/06 no
 * Personalizado produz exatamente a mesma janela que o botão "Esta semana", e
 * aceitar uma enquanto recusa a outra seria arbitrário.
 */
export function eSemanaFechada(from: string, to: string): boolean {
  if (!from || !to) return false;
  const s = semanaDePagamento(from);
  return s.from === from && s.to === to;
}

/**
 * Abre (ou reaproveita) a folha da janela e a aprova, reivindicando a produção.
 * Devolve o líquido já recalculado pelos gatilhos — é ele que deve ir ao recibo.
 */
export function useAbrirFolhaProducao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AbrirFolhaProducaoInput): Promise<FolhaProducaoAberta> => {
      const db = supabase;
      const period = periodoDeJanela(input.from, input.to);

      // 1) Já existe folha desta pessoa NESTE período exato?
      //    Rascunho é reaproveitado; finalizada não se toca.
      const { data: existentes, error: exErr } = await db
        .from('payroll_runs')
        .select('id, period, status, total_proventos, total_descontos, total_liquido, notes')
        .eq('employee_id', input.employeeId)
        .eq('period', period)
        .neq('status', 'cancelado')
        .limit(1);
      if (exErr) throw new Error(traduzErro(exErr.message));

      let run = (existentes?.[0] ?? null) as RunRow | null;

      if (run && run.status !== 'rascunho') {
        throw new Error(
          `Esta semana já tem folha ${run.status} para esta pessoa. Para pagar de novo, use a tela de Folha.`,
        );
      }

      // 2) Sem rascunho reaproveitável: cria um. Os valores entram zerados de
      //    propósito — quem os preenche é o gatilho de reivindicação, a partir
      //    do que estiver REALMENTE livre na janela.
      if (!run) {
        const { data: criada, error: insErr } = await db
          .from('payroll_runs')
          .insert({
            employee_id: input.employeeId,
            period,
            status: 'rascunho',
            total_proventos: 0,
            total_descontos: 0,
            total_liquido: 0,
          })
          .select('id, period, status, total_proventos, total_descontos, total_liquido, notes')
          .single();
        if (insErr) throw new Error(traduzErro(insErr.message));
        run = criada as RunRow;
      }

      // 3) rascunho → aprovado. É ESTE update que dispara a reivindicação da
      //    produção e o desconto dos adiantamentos.
      const { error: upErr } = await db
        .from('payroll_runs')
        .update({ status: 'aprovado' })
        .eq('id', run.id);
      if (upErr) throw new Error(traduzErro(upErr.message));

      // 4) Relê o que os gatilhos deixaram — nunca confiar no que a tela somou.
      const { data: final, error: relerErr } = await db
        .from('payroll_runs')
        .select('id, period, status, total_proventos, total_descontos, total_liquido, notes')
        .eq('id', run.id)
        .single();
      if (relerErr) throw new Error(traduzErro(relerErr.message));

      const f = final as RunRow;
      return {
        runId: f.id,
        period: f.period,
        bruto: num(f.total_proventos),
        descontos: num(f.total_descontos),
        liquido: num(f.total_liquido),
        notes: f.notes || '',
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      qc.invalidateQueries({ queryKey: ['ficha_montadores'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
