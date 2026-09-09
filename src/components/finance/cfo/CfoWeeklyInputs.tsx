import { useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/hooks/useAccessControl';
import { formatCurrency } from '@/lib/utils';
import { safeFormatBR } from '@/lib/date';
import { getCfoWeekKey, type CfoProjectionWeek } from '@/lib/cfoProjection';
import type { CfoPlan, CfoWeekInput } from '@/types/cfo';
import CfoWeekDialog from '@/components/finance/cfo/CfoWeekDialog';

interface Props { plan: CfoPlan; weeks: CfoProjectionWeek[]; records: CfoWeekInput[] }
const shortDate = (value: string) => safeFormatBR(value, '—', 'dd/MM');

export default function CfoWeeklyInputs({ plan, weeks, records }: Props) {
  const permission = useCan('/financeiro');
  const [editing, setEditing] = useState<CfoProjectionWeek | null>(null);
  const recordsByWeek = new Map(records.filter(record => record.plano_id === plan.id).map(record => [record.semana_inicio, record]));
  return <section className="space-y-3" aria-labelledby="cfo-weekly-title">
    <div><h3 id="cfo-weekly-title" className="text-base font-semibold">Preenchimento semanal</h3>
      <p className="text-sm text-muted-foreground">Preencha uma semana por vez, conforme acompanhar a produção. Ao salvar, informe as contas e o reinvestimento; atualize os pares quando apurar. As semanas futuras podem ficar sem preenchimento.</p></div>
    <div className="rounded-lg border border-border"><Table><TableHeader><TableRow>
      <TableHead>Semana</TableHead><TableHead className="text-right">Contas da semana</TableHead><TableHead className="text-right">Reinvestimento informado</TableHead><TableHead className="text-right">Pares produzidos</TableHead><TableHead className="text-right">Pares acumulados</TableHead><TableHead className="text-right">Preenchimento</TableHead>
    </TableRow></TableHeader><TableBody>{weeks.map(week => {
      const record = recordsByWeek.get(getCfoWeekKey(week.inicio));
      const canSave = record ? permission.canEdit : permission.canCreate;
      const label = `${shortDate(week.inicio)} a ${shortDate(week.fim)}`;
      return <TableRow key={week.inicio}>
        <TableCell className="whitespace-nowrap font-medium">{label}</TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{record ? formatCurrency(record.contas_semana) : <span className="text-muted-foreground">Não preenchido</span>}</TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{record ? formatCurrency(record.reinvestimento) : 'Não informado'}</TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{record?.pares_produzidos == null ? 'Não apurado' : record.pares_produzidos.toLocaleString('pt-BR')}</TableCell>
        <TableCell className="text-right tabular-nums">{week.paresAcumulados.toLocaleString('pt-BR')}</TableCell>
        <TableCell className="text-right">{canSave ? <Button variant={record ? 'ghost' : 'outline'} size="sm" aria-label={`${record ? 'Editar' : 'Preencher'} semana ${label}`} onClick={() => setEditing(week)}><PencilSimple className="mr-1.5 h-4 w-4" />{record ? 'Editar' : 'Preencher'}</Button> : <span className="text-xs text-muted-foreground">{record ? 'Informado' : 'Pendente'}</span>}</TableCell>
      </TableRow>;
    })}</TableBody></Table></div>
    <p className="text-xs text-muted-foreground">Pares acumulados somam somente as semanas já apuradas. A quantidade produzida não gera lucro nem recebimentos automaticamente.</p>
    {editing && <CfoWeekDialog key={`${plan.id}-${editing.inicio}`} plan={plan} week={editing} record={recordsByWeek.get(getCfoWeekKey(editing.inicio))} onClose={() => setEditing(null)} />}
  </section>;
}
