/**
 * F3 (audit): Conciliação bancária — match de extrato vs AP/AR.
 *
 * Fluxo:
 *   1) Usuário cola/cara CSV do extrato (data, descrição, valor) ou cola raw text.
 *   2) Sistema parseia e tenta casar cada linha com:
 *      - accounts_payable em aberto (mesmo valor, vencimento ±5 dias)
 *      - accounts_receivable em aberto (mesmo valor, vencimento ±5 dias)
 *   3) Para cada match (alta, média ou baixa confiança), usuário confirma e
 *      marca pago/recebido com a data do extrato.
 *
 * Não persiste o extrato em DB — é uma ferramenta de assistência. Os
 * lançamentos resultantes (mark paid/received) seguem o fluxo padrão e
 * geram audit trail normal.
 */

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Bank as Landmark, Upload, CheckCircle as CheckCircle2, Warning as AlertTriangle, X, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { useAccountsPayable, useAccountsReceivable } from '@/hooks/useFinance';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const fmt = (v: number | null | undefined) => {
  const n = Number(v);
  if (!isFinite(n)) return 'R$ —';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface StatementLine {
  raw: string;
  date: string | null;
  description: string;
  amount: number; // positivo = entrada, negativo = saída
}

interface MatchCandidate {
  type: 'payable' | 'receivable';
  id: string;
  description: string;
  party: string; // fornecedor ou cliente
  due_date: string;
  amount: number;
  confidence: 'alta' | 'media' | 'baixa';
}

/**
 * Parser tolerante. Aceita formatos comuns:
 *   01/05/2026;Pagamento boleto;-1234.56
 *   2026-05-01,DOC ENVIADO,1500.00
 *   01/05 PIX recebido R$ 350,00
 *
 * Heurística: data no início, valor no fim (último número), descrição no meio.
 */
function parseStatement(raw: string): StatementLine[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: StatementLine[] = [];
  for (const line of lines) {
    const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})|(\d{4}-\d{2}-\d{2})|(\d{2}\/\d{2})/);
    let date: string | null = null;
    if (dateMatch) {
      const m = dateMatch[0];
      if (m.includes('-')) {
        date = m;
      } else if (m.length === 5) {
        // DD/MM sem ano — assume ano corrente
        const [d, mo] = m.split('/');
        const y = new Date().getFullYear();
        date = `${y}-${mo}-${d}`;
      } else {
        const [d, mo, y] = m.split('/');
        date = `${y}-${mo}-${d}`;
      }
    }

    // Valor: último número do tipo "1234.56", "1234,56", "-1.234,56" ou "R$ 1.234,56"
    // Regex captura com sinal opcional, com ponto/vírgula como separadores.
    const amountMatches = line.match(/-?\s?R?\$?\s*(\d{1,3}(?:[.\s]\d{3})*[,.]?\d*)/g);
    let amount = 0;
    if (amountMatches && amountMatches.length > 0) {
      const last = amountMatches[amountMatches.length - 1];
      const isNeg = /^-/.test(last.trim());
      const cleaned = last.replace(/[R$\s-]/g, '');
      // Normaliza: se tem , como decimal (BR), troca . de milhar e , por .
      let num: number;
      if (/,\d{1,2}$/.test(cleaned)) {
        num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
      } else {
        num = parseFloat(cleaned.replace(/,/g, ''));
      }
      if (isFinite(num)) amount = isNeg ? -Math.abs(num) : num;
    }

    // Descrição: tudo entre data e valor (ou linha inteira sem data/valor)
    let description = line;
    if (dateMatch) description = description.replace(dateMatch[0], '').trim();
    if (amountMatches) description = description.replace(amountMatches[amountMatches.length - 1], '').trim();
    description = description.replace(/^[;,\s|]+|[;,\s|]+$/g, '').trim();

    if (amount === 0 && !date) continue;
    out.push({ raw: line, date, description, amount });
  }
  return out;
}

function findMatches(
  stmt: StatementLine,
  payables: any[],
  receivables: any[],
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const stmtAbsAmount = Math.abs(stmt.amount);

  // Saída (negativo) → busca AP em aberto
  if (stmt.amount < 0) {
    for (const p of payables as any[]) {
      if (p.status === 'paid' || p.status === 'cancelled') continue;
      const remaining = Math.max(0, (p.amount || 0) - (p.amount_paid || 0));
      if (Math.abs(remaining - stmtAbsAmount) > 0.05) continue;

      let confidence: MatchCandidate['confidence'] = 'baixa';
      if (stmt.date && p.due_date) {
        const diff = Math.abs(differenceInDays(parseISO(stmt.date), parseISO(p.due_date)));
        if (diff <= 2) confidence = 'alta';
        else if (diff <= 7) confidence = 'media';
        else if (diff <= 30) confidence = 'baixa';
        else continue;
      }
      // Texto: nome do fornecedor aparece na descrição? bonus
      if (p.suppliers?.name && stmt.description.toLowerCase().includes(p.suppliers.name.toLowerCase().split(' ')[0])) {
        confidence = confidence === 'baixa' ? 'media' : 'alta';
      }
      candidates.push({
        type: 'payable',
        id: p.id,
        description: p.description,
        party: p.suppliers?.name || '—',
        due_date: p.due_date,
        amount: remaining,
        confidence,
      });
    }
  }

  // Entrada (positivo) → busca AR em aberto
  if (stmt.amount > 0) {
    for (const r of receivables as any[]) {
      if (r.status === 'received' || r.status === 'cancelled') continue;
      const remaining = Math.max(0, (r.amount || 0) - (r.amount_received || 0));
      if (Math.abs(remaining - stmtAbsAmount) > 0.05) continue;

      let confidence: MatchCandidate['confidence'] = 'baixa';
      if (stmt.date && r.due_date) {
        const diff = Math.abs(differenceInDays(parseISO(stmt.date), parseISO(r.due_date)));
        if (diff <= 2) confidence = 'alta';
        else if (diff <= 7) confidence = 'media';
        else if (diff <= 30) confidence = 'baixa';
        else continue;
      }
      if (r.client_name && stmt.description.toLowerCase().includes(r.client_name.toLowerCase().split(' ')[0])) {
        confidence = confidence === 'baixa' ? 'media' : 'alta';
      }
      candidates.push({
        type: 'receivable',
        id: r.id,
        description: r.description,
        party: r.client_name || '—',
        due_date: r.due_date,
        amount: remaining,
        confidence,
      });
    }
  }

  // Ordena por confiança (alta primeiro), depois pela menor diferença de data
  return candidates.sort((a, b) => {
    const order = { alta: 0, media: 1, baixa: 2 };
    return order[a.confidence] - order[b.confidence];
  });
}

export default function BankReconciliationTab() {
  const { data: payables = [] } = useAccountsPayable();
  const { data: receivables = [] } = useAccountsReceivable();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [reconciled, setReconciled] = useState<Set<string>>(new Set()); // chave: stmtIdx + ':' + matchId
  const [busy, setBusy] = useState(false);
  const [confirmAutoOpen, setConfirmAutoOpen] = useState(false);

  const lines = useMemo(() => parseStatement(raw), [raw]);

  const lineMatches = useMemo(() => {
    return lines.map(l => ({ line: l, matches: findMatches(l, payables as any, receivables as any) }));
  }, [lines, payables, receivables]);

  const summary = useMemo(() => {
    const total = lineMatches.length;
    const matched = lineMatches.filter(lm => lm.matches.length > 0).length;
    const noMatch = total - matched;
    const totalIn = lineMatches.filter(lm => lm.line.amount > 0).reduce((s, lm) => s + lm.line.amount, 0);
    const totalOut = lineMatches.filter(lm => lm.line.amount < 0).reduce((s, lm) => s + Math.abs(lm.line.amount), 0);
    return { total, matched, noMatch, totalIn, totalOut };
  }, [lineMatches]);

  // Auto-conciliação: linhas com EXATAMENTE um match de ALTA confiança (sem
  // ambiguidade) e ainda não conciliadas. Conservador de propósito — uma ação
  // financeira automática não deve adivinhar entre dois candidatos plausíveis;
  // linhas com 2+ candidatos altos ficam pro usuário decidir manualmente.
  const autoMatchable = useMemo(() => {
    const out: { lineIdx: number; match: MatchCandidate }[] = [];
    lineMatches.forEach((lm, idx) => {
      const altas = lm.matches.filter(m => m.confidence === 'alta');
      if (altas.length === 1 && !reconciled.has(`${idx}:${altas[0].id}`)) {
        out.push({ lineIdx: idx, match: altas[0] });
      }
    });
    return out;
  }, [lineMatches, reconciled]);

  const reconcile = async (lineIdx: number, match: MatchCandidate) => {
    const key = `${lineIdx}:${match.id}`;
    if (reconciled.has(key)) return;
    setBusy(true);
    const stmt = lineMatches[lineIdx]?.line;
    const paymentDate = stmt?.date || format(new Date(), 'yyyy-MM-dd');
    try {
      // match.amount é o SALDO restante (amount − já pago/recebido). SOMAR ao
      // existente — antes sobrescrevia amount_paid/received com só o saldo,
      // apagando um pagamento parcial anterior e corrompendo os totais.
      // Marca 'paid'/'received' só quando quita; senão 'parcial'.
      // Auditoria 2026-06-14, Área 5 (🟠).
      const EPS = 0.005;
      if (match.type === 'payable') {
        const { data: cur, error: curErr } = await supabase
          .from('accounts_payable')
          .select('amount, amount_paid, status')
          .eq('id', match.id)
          .single();
        if (curErr) throw curErr;
        if (cur.status === 'paid' || cur.status === 'cancelled') {
          toast.warning(`Conta a pagar ${match.id.slice(0, 8)} já estava paga ou cancelada.`);
          return;
        }
        const newPaid = Number(cur.amount_paid || 0) + match.amount;
        const fullyPaid = newPaid >= Number(cur.amount || 0) - EPS;
        const { data: claimed, error } = await supabase
          .from('accounts_payable')
          .update({ status: fullyPaid ? 'paid' : 'parcial', amount_paid: newPaid, payment_date: paymentDate })
          .eq('id', match.id)
          .not('status', 'in', '(paid,cancelled)')
          .select('id');
        if (error) throw error;
        if (!claimed?.length) {
          toast.warning(`Conta a pagar ${match.id.slice(0, 8)} já estava paga ou cancelada.`);
          return;
        }
      } else {
        const { data: cur, error: curErr } = await supabase
          .from('accounts_receivable')
          .select('amount, amount_received, status')
          .eq('id', match.id)
          .single();
        if (curErr) throw curErr;
        if (cur.status === 'received' || cur.status === 'cancelled') {
          toast.warning(`Conta a receber ${match.id.slice(0, 8)} já estava recebida ou cancelada.`);
          return;
        }
        const newReceived = Number(cur.amount_received || 0) + match.amount;
        const fullyReceived = newReceived >= Number(cur.amount || 0) - EPS;
        const { data: claimed, error } = await supabase
          .from('accounts_receivable')
          .update({ status: fullyReceived ? 'received' : 'parcial', amount_received: newReceived, payment_date: paymentDate })
          .eq('id', match.id)
          .not('status', 'in', '(received,cancelled)')
          .select('id');
        if (error) throw error;
        if (!claimed?.length) {
          toast.warning(`Conta a receber ${match.id.slice(0, 8)} já estava recebida ou cancelada.`);
          return;
        }
      }
      setReconciled(prev => new Set(prev).add(key));
      toast.success(`Conciliada com sucesso (${fmt(match.amount)} em ${paymentDate}).`);
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    } catch (err: any) {
      toast.error('Falha ao conciliar: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  // Conciliação em lote dos matches de alta confiança (1 clique em vez de N).
  // Reusa reconcile() — herda o guard .not(status in paid/cancelled), então é
  // idempotente mesmo se o estado React estiver defasado dentro do loop.
  const autoReconcileHighConfidence = async () => {
    if (!autoMatchable.length || busy) return;
    const batch = [...autoMatchable];
    for (const { lineIdx, match } of batch) {
      await reconcile(lineIdx, match);
    }
    toast.success(`Auto-conciliação concluída — ${batch.length} de alta confiança processado(s).`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" /> Conciliação Bancária
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Cole o extrato do banco (CSV, OFX exportado em texto, ou colado direto do internet banking).
            O sistema tenta casar cada linha com contas a pagar/receber em aberto.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder={`01/05/2026;Pagamento Boleto Fornecedor X;-1234,56\n02/05/2026;PIX recebido Cliente Y;3500,00\n...`}
            rows={5}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setRaw('')} disabled={!raw}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['accounts_payable'] });
                qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Recarregar contas
            </Button>
            {autoMatchable.length > 0 && (
              <Button size="sm" onClick={() => setConfirmAutoOpen(true)} disabled={busy} className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Conciliar {autoMatchable.length} de alta confiança
              </Button>
            )}
            <AlertDialog open={confirmAutoOpen} onOpenChange={setConfirmAutoOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Conciliar {autoMatchable.length} lançamento{autoMatchable.length === 1 ? '' : 's'} de alta confiança?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Cada conta será marcada como paga/recebida com a data do extrato.
                    A ação segue o fluxo normal de baixa e gera audit trail.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setConfirmAutoOpen(false); autoReconcileHighConfidence(); }}>
                    Conciliar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {summary.total > 0 && (
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <Badge variant="outline">{summary.total} linha(s)</Badge>
                <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                  {summary.matched} com match
                </Badge>
                {summary.noMatch > 0 && (
                  <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                    {summary.noMatch} sem match
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono">Entradas: {fmt(summary.totalIn)}</Badge>
                <Badge variant="outline" className="font-mono">Saídas: {fmt(summary.totalOut)}</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {lineMatches.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Linhas do extrato</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Match sugerido</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineMatches.map((lm, idx) => {
                  const top = lm.matches[0];
                  const isIncome = lm.line.amount > 0;
                  return (
                    <TableRow key={idx} className="align-top">
                      <TableCell className="text-xs whitespace-nowrap">
                        {lm.line.date || <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="text-xs max-w-[260px] truncate" title={lm.line.description}>
                        {lm.line.description || <span className="text-muted-foreground italic">(sem descrição)</span>}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${isIncome ? 'text-green-600' : 'text-destructive'}`}>
                        {isIncome ? '+' : '-'}{fmt(Math.abs(lm.line.amount))}
                      </TableCell>
                      <TableCell>
                        {top ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={`text-xs gap-1 ${
                                  top.confidence === 'alta'
                                    ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                                    : top.confidence === 'media'
                                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                      : 'bg-muted text-muted-foreground border-border'
                                }`}
                              >
                                {top.confidence === 'alta' ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                                {top.confidence}
                              </Badge>
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                {top.type === 'payable' ? 'A pagar' : 'A receber'}
                              </span>
                            </div>
                            <p className="text-xs font-medium">{top.party}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[260px]" title={top.description}>
                              {top.description} · venc {format(parseISO(top.due_date), 'dd/MM/yy')}
                            </p>
                            {lm.matches.length > 1 && (
                              <p className="text-xs text-muted-foreground italic">+{lm.matches.length - 1} outro(s) match(es) possível(eis)</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Sem candidato</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {top && (
                          <Button
                            size="sm"
                            variant={top.confidence === 'alta' ? 'default' : 'outline'}
                            disabled={busy || reconciled.has(`${idx}:${top.id}`)}
                            onClick={() => reconcile(idx, top)}
                            className="h-7 text-xs gap-1"
                          >
                            {reconciled.has(`${idx}:${top.id}`) ? (
                              <><CheckCircle2 className="h-3 w-3" /> OK</>
                            ) : (
                              <>Conciliar</>
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {lineMatches.length === 0 && raw.trim().length > 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Upload className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Nenhuma linha reconhecida. Verifique se cada linha tem data e valor.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
