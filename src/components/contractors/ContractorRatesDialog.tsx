import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { CurrencyDollar } from '@phosphor-icons/react';
import { formatDateBR } from '@/lib/dateOnly';
import { SERVICE_ORDER_SECTORS as SECTOR_OPTIONS, serviceOrderSectorLabel as sectorLabel } from '@/lib/serviceOrderSectors';

/**
 * Tabela de Preços da terceirizada (contractor_service_rates — Fase 1 facção).
 * Preço por serviço (target_sector) com VIGÊNCIA: adicionar tarifa nova
 * encerra a anterior do mesmo serviço (valid_to = véspera). Sem editar o
 * passado — histórico preservado pra auditoria/fechamento.
 */

// Setores compartilhados com o form manual de OS (src/lib/serviceOrderSectors) —
// os value têm de bater p/ o lookup de tarifa por (contratada+setor) funcionar.

// contractor_service_rates fora do types.ts (regenerar depois) — tipo local.
interface RateRow {
  id: string;
  sector: string;
  price_per_pair: number;
  valid_from: string;
  valid_to: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractor: { id: string; name: string } | null;
}

export function ContractorRatesDialog({ open, onOpenChange, contractor }: Props) {
  const qc = useQueryClient();
  const contractorId = contractor?.id ?? null;

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['contractor_service_rates', contractorId],
    enabled: open && !!contractorId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('contractor_service_rates')
        .select('id, sector, price_per_pair, valid_from, valid_to')
        .eq('contractor_id', contractorId)
        .order('sector')
        .order('valid_from', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RateRow[];
    },
  });

  const [newSector, setNewSector] = useState('corte_cabedal');
  const [newPrice, setNewPrice] = useState(0);
  const [newFrom, setNewFrom] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!contractorId || saving) return;
    if (newPrice <= 0) { toast.error('Informe o preço por par.'); return; }
    setSaving(true);
    try {
      // Encerra a vigência aberta do mesmo serviço (valid_to = véspera)
      const prevDay = new Date(newFrom + 'T00:00:00');
      prevDay.setDate(prevDay.getDate() - 1);
      const prevDayIso = prevDay.toLocaleDateString('sv-SE');
      const { error: closeErr } = await (supabase as any)
        .from('contractor_service_rates')
        .update({ valid_to: prevDayIso })
        .eq('contractor_id', contractorId)
        .eq('sector', newSector)
        .is('valid_to', null)
        .lt('valid_from', newFrom);
      if (closeErr) throw closeErr;

      const { error } = await (supabase as any).from('contractor_service_rates').insert({
        contractor_id: contractorId,
        sector: newSector,
        price_per_pair: newPrice,
        valid_from: newFrom,
      });
      if (error) throw error;
      toast.success(`Tarifa de ${sectorLabel(newSector)} cadastrada: R$ ${newPrice.toFixed(2)}/par a partir de ${formatDateBR(newFrom)}.`);
      setNewPrice(0);
      qc.invalidateQueries({ queryKey: ['contractor_service_rates', contractorId] });
      qc.invalidateQueries({ queryKey: ['contractor_rate'] });
    } catch (e: any) {
      toast.error(`Falha ao cadastrar tarifa: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CurrencyDollar className="h-4 w-4" />
            Tabela de Preços — {contractor?.name ?? ''}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_110px_130px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Serviço</Label>
            <Select value={newSector} onValueChange={setNewSector}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SECTOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">R$/par</Label>
            <NumberInput value={newPrice} onChange={(v) => setNewPrice(Number(v ?? 0))} step="0.01" min={0} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Vigente a partir de</Label>
            <Input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="h-9" />
          </div>
          <Button className="h-9" onClick={handleAdd} disabled={saving || newPrice <= 0}>
            Adicionar
          </Button>
        </div>

        {isLoading ? null : rates.length === 0 ? (
          <EmptyState
            icon={CurrencyDollar}
            title="Nenhuma tarifa cadastrada"
            description="Sem tarifa, as OSs nascem sem preço e a conta a pagar não é calculada."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Serviço</TableHead>
                <TableHead className="text-xs text-right">R$/par</TableHead>
                <TableHead className="text-xs">Vigência</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => {
                const active = !r.valid_to;
                return (
                  <TableRow key={r.id} className={active ? '' : 'opacity-60'}>
                    <TableCell className="text-xs">{sectorLabel(r.sector)}</TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      {Number(r.price_per_pair).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateBR(r.valid_from)}{r.valid_to ? ` — ${formatDateBR(r.valid_to)}` : ' — atual'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {active && <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">vigente</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
