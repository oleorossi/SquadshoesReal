import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Warning as AlertTriangle, Hammer, ShoppingBag, CheckCircle as CheckCircle2, SkipForward, UsersThree, Lightning } from '@phosphor-icons/react';
import {
  detectStrapShortagesForSaleOrder,
  type StrapShortage,
  type StrapIncompleteItem,
} from '@/lib/strapShortages';

type Mode = 'artesanal' | 'comprar';

interface RowState {
  shortage: StrapShortage;
  mode: Mode;
  contractor_id: string;
}

interface Contractor {
  id: string;
  name: string;
  service_type: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  onClose: () => void;
}

/**
 * Diálogo mostrado ao salvar um PV que tem TIRAS com estoque insuficiente.
 *
 * Pra cada tira em falta:
 *  - Modo "Artesanal" → gera service_order pra contractor escolhido (corta/costura
 *    a tira a partir da matéria-prima)
 *  - Modo "Comprar pronto" → gera purchase_order do produto-tira pronto na cor
 *    (precisa de fornecedor cadastrado no grupo do material-tira)
 *
 * Tiras com cor não preenchida no PV são listadas como BLOCKERS (não dá pra gerar
 * docs sem cor; user precisa voltar e preencher).
 */
export function StrapShortageDialog({ open, saleOrderId, saleOrderNumber, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [incomplete, setIncomplete] = useState<StrapIncompleteItem[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [suppliersByGroup, setSuppliersByGroup] = useState<Map<string, Supplier>>(new Map());
  // Prestador "mestre": escolhido no topo e aplicado a TODAS as tiras de uma vez.
  const [bulkContractor, setBulkContractor] = useState('');

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [report, { data: c }] = await Promise.all([
          detectStrapShortagesForSaleOrder(saleOrderId),
          supabase.from('contractors').select('id, name, service_type').eq('active', true).order('name'),
        ]);
        if (cancelled) return;
        const all = (c || []) as Contractor[];
        const costuraFirst = all.filter(x => /costura|pesponto|tira/i.test(x.service_type || ''));
        const others = all.filter(x => !/costura|pesponto|tira/i.test(x.service_type || ''));
        const ordered = [...costuraFirst, ...others];
        setContractors(ordered);

        // Resolve fornecedor preferido pra cada group_id (pra OC de tira pronta).
        const groupIds = Array.from(new Set(report.shortages.map(s => s.group_id).filter(Boolean) as string[]));
        const supByGroup = new Map<string, Supplier>();
        if (groupIds.length > 0) {
          const { data: gp } = await supabase
            .from('products')
            .select('group_id, supplier_id, suppliers!products_supplier_id_fkey(id, name)')
            .in('group_id', groupIds)
            .not('supplier_id', 'is', null)
            .limit(500);
          for (const r of (gp || []) as any[]) {
            if (r.group_id && r.suppliers && !supByGroup.has(r.group_id)) {
              supByGroup.set(r.group_id, { id: r.suppliers.id, name: r.suppliers.name });
            }
          }
        }
        setSuppliersByGroup(supByGroup);

        const initialContractor = ordered[0]?.id || '';
        setBulkContractor(initialContractor);
        setRows(report.shortages.map(s => ({
          shortage: s,
          mode: 'artesanal' as Mode,
          contractor_id: initialContractor,
        })));
        setIncomplete(report.incomplete);
      } catch (e: any) {
        toast.error(`Falha ao detectar tiras: ${e.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, saleOrderId]);

  const updateRow = (idx: number, patch: Partial<RowState>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  /** Aplica UM prestador a TODAS as tiras de uma vez (mestre no topo). Cada item
   *  continua editável individualmente abaixo. */
  const applyBulkContractor = (contractorId: string) => {
    setBulkContractor(contractorId);
    setRows(prev => prev.map(r => ({ ...r, contractor_id: contractorId })));
  };

  /** Aplica um modo (Artesanal/Comprar) a todas as tiras de uma vez. */
  const applyBulkMode = (mode: Mode) => {
    setRows(prev => prev.map(r => ({ ...r, mode })));
  };

  // Resumo pro cabeçalho do controle mestre (quantos itens em cada modo).
  const artesanalCount = rows.filter(r => r.mode === 'artesanal').length;
  const comprarCount = rows.length - artesanalCount;

  /**
   * Pular esta etapa: fecha SEM gerar OS/OC e SEM escolher quem faz as tiras.
   * O PV já está salvo; as tiras em falta podem ser resolvidas depois (pelo card
   * do PV / Terceirizados). Sempre disponível, mesmo com itens sem cor.
   */
  const handleSkip = () => {
    toast.info('Etapa das tiras pulada — você pode gerar as OS/OC depois pelo PV.');
    onClose();
  };

  const handleConfirm = async () => {
    if (incomplete.length > 0) {
      toast.error('Tem item sem cor de tira selecionada. Volte ao PV e preencha primeiro.');
      return;
    }
    if (rows.length === 0) {
      onClose();
      return;
    }

    setCommitting(true);
    try {
      const artesanal = rows.filter(r => r.mode === 'artesanal');
      const comprar = rows.filter(r => r.mode === 'comprar');

      // 1) Artesanal → service_orders
      // Auditoria 2026-06-28: este branch era a fábrica das 235 OS-lixo do MARCO
      // (R$0, SEM vínculo de PV, material_name vazio). Correção: a OS agora nasce
      // RASTREÁVEL — vinculada ao PV (sale_order_id) e com material_name preenchido
      // (label+cor da tira), então nunca mais vira "órfã/vazia". O preço continua 0
      // enquanto não houver tarifa cadastrada (contractor_service_rates) — nesse
      // caso avisamos, em vez de gravar R$0 em silêncio.
      let zeroRateCount = 0;
      for (const r of artesanal) {
        if (!r.contractor_id) {
          throw new Error(`Selecione o prestador pra ${r.shortage.strap_label} ${r.shortage.strap_color}.`);
        }
        const materialName = `TIRA ${r.shortage.strap_label} ${r.shortage.strap_color}`.trim();
        const desc = `TIRA ARTESANAL · ${r.shortage.strap_label} ${r.shortage.strap_color}` +
          ` · Ref ${r.shortage.cabedal_color}` +
          ` · ${r.shortage.shortage.toFixed(0)} ${r.shortage.product_id ? 'un faltam' : 'un (novo produto)'}`;
        const { error } = await supabase.from('service_orders').insert({
          contractor_id: r.contractor_id,
          sale_order_id: saleOrderId,
          material_name: materialName,
          description: desc,
          service_date: new Date().toISOString().slice(0, 10),
          quantity: Math.ceil(r.shortage.shortage),
          unit_price: 0,
          total_value: 0,
          status: 'Pendente',
        } as any);
        if (error) throw new Error(`OS ${r.shortage.strap_label}: ${error.message}`);
        zeroRateCount++;
      }
      if (zeroRateCount > 0) {
        toast.warning(
          `${zeroRateCount} OS de tira criada(s) a R$0 — cadastre a tarifa do prestador em Terceirizados → Tarifas por Referência pra valorar.`,
        );
      }

      // 2) Comprar Pronto → purchase_orders + items
      for (const r of comprar) {
        if (!r.shortage.product_id) {
          throw new Error(
            `Pra comprar ${r.shortage.strap_label} ${r.shortage.strap_color} pronta, ` +
            `primeiro cadastre o produto-tira nessa cor em /estoque.`
          );
        }
        const sup = r.shortage.group_id ? suppliersByGroup.get(r.shortage.group_id) : null;
        if (!sup) {
          throw new Error(
            `Sem fornecedor cadastrado pro grupo da ${r.shortage.strap_label}. ` +
            `Vincule um supplier ao produto-tira ou ao grupo do material.`
          );
        }
        const { data: poRow, error: poErr } = await supabase.from('purchase_orders').insert({
          supplier_id: sup.id,
          status: 'Pendente',
          notes: `Auto-gerada por PV ${saleOrderNumber || '?'} (tira ${r.shortage.strap_color}).`,
        } as any).select('id').single();
        if (poErr) throw new Error(`OC ${r.shortage.strap_color}: ${poErr.message}`);
        const { error: poItemErr } = await supabase.from('purchase_order_items').insert({
          purchase_order_id: (poRow as any).id,
          product_id: r.shortage.product_id,
          quantity: Math.ceil(r.shortage.shortage),
          unit_price: 0,
        } as any);
        if (poItemErr) throw new Error(`OC item ${r.shortage.strap_color}: ${poItemErr.message}`);
      }

      toast.success(
        `${artesanal.length} OS${artesanal.length === 1 ? '' : 's'} + ${comprar.length} OC${comprar.length === 1 ? '' : 's'} gerada${(artesanal.length + comprar.length) === 1 ? '' : 's'}.`
      );
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Falha ao gerar documentos');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Tiras em falta{saleOrderNumber ? ` · ${saleOrderNumber}` : ''}
          </DialogTitle>
          <DialogDescription>
            Pra cada tira sem estoque, escolha <strong>Artesanal</strong> (gera OS pra contractor
            cortar/costurar) ou <strong>Comprar pronto</strong> (gera OC do produto-tira na cor).
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="text-sm text-muted-foreground py-4">Calculando shortages…</div>
        )}

        {!loading && incomplete.length > 0 && (
          <div className="rounded-md border-2 border-destructive/40 bg-destructive/5 p-3 space-y-1">
            <div className="text-sm font-bold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {incomplete.length} item{incomplete.length === 1 ? '' : 's'} sem cor de tira preenchida
            </div>
            <p className="text-xs text-destructive/80">
              Volte ao PV, abra cada item e selecione a cor de cada tira. O sistema só
              consegue gerar OS/OC quando a cor da tira está definida.
            </p>
          </div>
        )}

        {!loading && rows.length === 0 && incomplete.length === 0 && (
          <div className="rounded-md border border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 text-sm text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Estoque suficiente pra todas as tiras deste PV.
          </div>
        )}

        {/* Controle MESTRE — define prestador + modo pra TODAS as tiras de uma vez.
            Cada item continua editável individualmente na lista abaixo. */}
        {!loading && rows.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <UsersThree className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Aplicar a todas as {rows.length} tiras
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Modo (todas)</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    type="button"
                    variant={comprarCount === 0 ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => applyBulkMode('artesanal')}
                  >
                    <Hammer className="h-3.5 w-3.5" /> Artesanal
                  </Button>
                  <Button
                    type="button"
                    variant={artesanalCount === 0 ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => applyBulkMode('comprar')}
                  >
                    <ShoppingBag className="h-3.5 w-3.5" /> Comprar
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground">Prestador (todas artesanais)</Label>
                <Select value={bulkContractor} onValueChange={applyBulkContractor}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecionar prestador" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractors.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhum prestador ativo. Cadastre em Terceiros › Prestadores.
                      </div>
                    )}
                    {contractors.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.service_type ? ` · ${c.service_type}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Lightning className="h-3 w-3 text-primary shrink-0" />
              Define de uma vez; você ainda pode ajustar itens específicos abaixo.
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((r, idx) => {
              const sup = r.shortage.group_id ? suppliersByGroup.get(r.shortage.group_id) : null;
              return (
                <div key={`${r.shortage.sale_order_item_id}-${r.shortage.strap_label}-${idx}`}
                     className="rounded-lg border bg-card p-3 space-y-2.5">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm font-bold uppercase tracking-tight">
                        {r.shortage.strap_label} · {r.shortage.strap_color}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Cabedal {r.shortage.cabedal_color} · {r.shortage.pairs} pares
                        {r.shortage.product_name ? ` · ${r.shortage.product_name}` : ' · produto-tira NÃO cadastrado'}
                      </div>
                    </div>
                    <div className="text-xs font-mono text-right">
                      <div><span className="text-muted-foreground">Necessário:</span> {r.shortage.required.toFixed(0)}</div>
                      <div><span className="text-muted-foreground">Estoque:</span> {r.shortage.available.toFixed(0)}</div>
                      <div className="text-amber-600 font-bold">Falta: {r.shortage.shortage.toFixed(0)}</div>
                    </div>
                  </div>

                  <Tabs value={r.mode} onValueChange={(v) => updateRow(idx, { mode: v as Mode })}>
                    <TabsList className="grid grid-cols-2 w-full h-8">
                      <TabsTrigger value="artesanal" className="text-xs gap-1.5">
                        <Hammer className="h-3.5 w-3.5" /> Artesanal (OS)
                      </TabsTrigger>
                      <TabsTrigger value="comprar" className="text-xs gap-1.5">
                        <ShoppingBag className="h-3.5 w-3.5" /> Comprar pronto (OC)
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {r.mode === 'artesanal' && (
                    <div>
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Prestador <span className="font-normal normal-case tracking-normal text-muted-foreground/70">(deste item)</span>
                      </Label>
                      <Select
                        value={r.contractor_id}
                        onValueChange={(v) => updateRow(idx, { contractor_id: v })}
                      >
                        <SelectTrigger className="mt-1 h-9 text-sm">
                          <SelectValue placeholder="Selecionar prestador" />
                        </SelectTrigger>
                        <SelectContent>
                          {contractors.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              Nenhum prestador ativo. Cadastre em Terceiros › Prestadores.
                            </div>
                          )}
                          {contractors.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}{c.service_type ? ` · ${c.service_type}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {r.mode === 'comprar' && (
                    <div className="text-xs space-y-1">
                      {!r.shortage.product_id && (
                        <p className="text-destructive">
                          ⚠ Produto-tira <strong>{r.shortage.strap_color}</strong> ainda não existe no estoque.
                          Cadastre antes em /estoque pra gerar OC.
                        </p>
                      )}
                      {r.shortage.product_id && sup && (
                        <p className="text-muted-foreground">
                          Fornecedor: <strong className="text-foreground">{sup.name}</strong>
                        </p>
                      )}
                      {r.shortage.product_id && !sup && (
                        <p className="text-destructive">
                          ⚠ Nenhum fornecedor vinculado ao grupo desta tira.
                          Cadastre antes em /estoque ou /suppliers pra gerar OC.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={handleSkip} disabled={committing} className="gap-2">
            <SkipForward className="h-4 w-4" />
            Pular esta etapa
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={committing || loading || incomplete.length > 0 || rows.length === 0}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Gerar documentos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
