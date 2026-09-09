import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSaveCfoWeek } from '@/hooks/useCfo';
import { getCfoWeekKey, type CfoProjectionWeek } from '@/lib/cfoProjection';
import { safeFormatBR } from '@/lib/date';
import type { CfoPlan, CfoWeekInput } from '@/types/cfo';

interface Props { plan: CfoPlan; week: CfoProjectionWeek; record?: CfoWeekInput; onClose: () => void }

// Campos começam vazios: a ausência de preenchimento não pode confirmar R$ 0,00.
function parseMoney(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value) && !/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) return null;
  const normalized = value.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(value)
    ? value.replace(/\./g, '').replace(',', '.') : value;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 999_999_999_999.99 ? amount : null;
}

const moneyField = (value?: number) => value === undefined ? '' : value.toFixed(2).replace('.', ',');

export default function CfoWeekDialog({ plan, week, record, onClose }: Props) {
  const [accounts, setAccounts] = useState(() => moneyField(record?.contas_semana));
  const [reinvestment, setReinvestment] = useState(() => moneyField(record?.reinvestimento));
  const [pairs, setPairs] = useState(() => record?.pares_produzidos == null ? '' : String(record.pares_produzidos));
  const [error, setError] = useState('');
  const save = useSaveCfoWeek();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const accountsValue = parseMoney(accounts);
    if (accountsValue === null) { setError('Informe o valor das contas da semana. Use 0 se não houver contas.'); return; }
    const reinvestmentValue = parseMoney(reinvestment);
    if (reinvestmentValue === null) { setError('Informe o valor que você decidiu reinvestir. Use 0 se não houver reinvestimento.'); return; }
    const pairsValue = pairs.trim() ? Number(pairs) : null;
    if (pairsValue !== null && (!/^\d+$/.test(pairs.trim()) || !Number.isInteger(pairsValue) || pairsValue < 0 || pairsValue > 2_147_483_647)) {
      setError('Informe uma quantidade inteira de pares, igual ou maior que zero.'); return;
    }
    try {
      await save.mutateAsync({
        ...(record ? { id: record.id } : {}), plano_id: plan.id,
        semana_inicio: getCfoWeekKey(week.inicio), contas_semana: accountsValue,
        reinvestimento: reinvestmentValue, pares_produzidos: pairsValue,
      });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Confira os dados e tente novamente.'); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Preencher semana</DialogTitle><DialogDescription>{safeFormatBR(week.inicio)} a {safeFormatBR(week.fim)}. Informe os totais para estas datas.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset disabled={save.isPending} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="cfo-week-accounts">Contas a pagar na semana (R$) <span aria-hidden="true" className="text-destructive">*</span></Label>
            <Input id="cfo-week-accounts" inputMode="decimal" value={accounts} onChange={event => setAccounts(event.target.value)} placeholder="Informe o valor" required aria-required="true" autoFocus />
            <p className="text-xs text-muted-foreground">Obrigatório. Total de despesas e retiradas, sem os materiais do reinvestimento. Informe 0 quando não houver contas.</p></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-week-reinvestment">Reinvestimento em materiais (R$)</Label>
            <Input id="cfo-week-reinvestment" inputMode="decimal" value={reinvestment} onChange={event => setReinvestment(event.target.value)} placeholder="Informe quanto vai reinvestir" required aria-required="true" />
            <p className="text-xs text-muted-foreground">Valor total que você escolhe destinar a materiais nesta semana. Pode ser 0; não é preenchido automaticamente com a sobra do caixa.</p></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-week-pairs">Pares produzidos na semana</Label>
            <Input id="cfo-week-pairs" inputMode="numeric" value={pairs} onChange={event => setPairs(event.target.value)} placeholder="Quantidade concluída nesta semana" />
            <p className="text-xs text-muted-foreground">Informe apenas os pares desta semana. O acumulado é calculado pelo CFO. Deixe vazio enquanto não apurou ou informe 0 se não houve produção.</p></div>
        </fieldset>
        <p className="rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed">Os lançamentos já detalhados entram nesses totais. Só o valor ainda não detalhado é acrescentado à projeção, no início da semana. Se os lançamentos superarem o valor informado, o CFO mostra o excedente.</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar semana'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
