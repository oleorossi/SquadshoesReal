/**
 * Ateliê → aba Tiras: faltas de Fábrica/Prestador, Gerar OC+OS, Produzido, Recebido.
 * specs/tira-material-de-estoque.md R16–R18.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleNotch as Loader2,
  Factory,
  Package,
  Scissors,
  Truck,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useContractors } from '@/hooks/useContractors';
import {
  useAtelierSetStrapYield,
  useAtelierStrapJobs,
  useAtelierStrapShortages,
  useGenerateAtelierStrapPurchaseAndService,
  useRegisterAtelierStrapProduced,
  useRegisterAtelierStrapReceived,
  type AtelierStrapJob,
  type AtelierStrapShortage,
} from '@/hooks/useAtelierStraps';
import { cn } from '@/lib/utils';

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

function napaNeeded(strapM: number, yieldM: number | null | undefined) {
  if (!(yieldM && yieldM > 0) || !(strapM > 0)) return null;
  return Math.ceil((strapM / yieldM) * 100) / 100;
}

function ShortageCard({
  row,
  contractors,
}: {
  row: AtelierStrapShortage;
  contractors: { id: string; name: string }[];
}) {
  const generate = useGenerateAtelierStrapPurchaseAndService();
  const produce = useRegisterAtelierStrapProduced();
  const setYield = useAtelierSetStrapYield();

  const [contractorId, setContractorId] = useState(row.default_contractor_id ?? '');
  const [yieldDraft, setYieldDraft] = useState(
    row.yield_m_per_m != null ? String(row.yield_m_per_m) : '',
  );
  const [strapM, setStrapM] = useState(String(row.to_produce_m || row.shortage_m || ''));
  const [napaMDraft, setNapaMDraft] = useState('');

  const strapNum = Number(String(strapM).replace(',', '.')) || 0;
  const yieldNum = row.yield_m_per_m;
  const suggestedNapa = napaNeeded(strapNum, yieldNum);
  const missingYield = !(yieldNum && yieldNum > 0);
  const canAct = row.to_produce_m > 0 && !missingYield;
  const busy = generate.isPending || produce.isPending || setYield.isPending;

  const saveYield = () => {
    if (!row.napa_group_id) return;
    const v = Number(String(yieldDraft).replace(',', '.'));
    if (!(v > 0)) return;
    setYield.mutate({
      strapGroupId: row.group_id,
      napaGroupId: row.napa_group_id,
      yieldMPerM: v,
    });
  };

  return (
    <div className="space-y-2 border border-border/60 bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {row.order_number}
            {row.client_name ? (
              <span className="ml-1.5 font-normal text-muted-foreground">· {row.client_name}</span>
            ) : null}
          </p>
          <p className="truncate text-xs text-foreground">{row.product_name}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.origin === 'prestador' ? 'Prestador' : row.origin === 'fabrica' ? 'Fábrica' : row.origin}
            {row.color ? ` · ${row.color}` : ''}
          </p>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <div>Falta <strong>{fmt(row.shortage_m)}</strong> m</div>
          {row.in_progress_m > 0 && (
            <div className="text-muted-foreground">Em curso {fmt(row.in_progress_m)} m</div>
          )}
          <div className="text-muted-foreground">A produzir {fmt(row.to_produce_m)} m</div>
        </div>
      </div>

      {missingYield ? (
        <div className="flex flex-wrap items-end gap-2 border border-amber-500/30 bg-amber-500/10 p-2">
          <p className="w-full text-[11px] text-amber-800 dark:text-amber-300">
            Informe o rendimento (m de tira por m de napa) para{' '}
            <strong>{row.napa_group_name || 'a napa'}</strong>. Grava no grupo da tira.
          </p>
          <Input
            className="h-8 w-24 font-mono text-xs"
            inputMode="decimal"
            value={yieldDraft}
            onChange={(e) => setYieldDraft(e.target.value)}
            placeholder="70"
            disabled={!row.napa_group_id || busy}
          />
          <span className="text-[10px] text-muted-foreground">m/m</span>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!row.napa_group_id || busy}
            onClick={saveYield}
          >
            Salvar rendimento
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Rend. {fmt(yieldNum, 0)} m/m
          {suggestedNapa != null && (
            <> · napa ≈ <strong className="text-foreground">{fmt(suggestedNapa)} m</strong>
              {row.napa_product_name ? ` de ${row.napa_product_name}` : ''}
            </>
          )}
          {row.napa_supplier_name ? ` · forn. ${row.napa_supplier_name}` : ''}
        </p>
      )}

      {row.to_produce_m > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Metros de tira</label>
            <Input
              className="mt-0.5 h-8 w-28 font-mono text-xs"
              inputMode="decimal"
              value={strapM}
              onChange={(e) => setStrapM(e.target.value)}
              disabled={busy}
            />
          </div>

          {row.origin === 'prestador' && (
            <div className="min-w-[10rem] flex-1">
              <label className="text-[10px] uppercase text-muted-foreground">Prestador</label>
              <Select value={contractorId || undefined} onValueChange={setContractorId}>
                <SelectTrigger className="mt-0.5 h-8">
                  <SelectValue placeholder="Escolher" />
                </SelectTrigger>
                <SelectContent>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {row.origin === 'fabrica' && (
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">
                Napa usada (m)
              </label>
              <Input
                className="mt-0.5 h-8 w-28 font-mono text-xs"
                inputMode="decimal"
                value={napaMDraft || (suggestedNapa != null ? String(suggestedNapa) : '')}
                onChange={(e) => setNapaMDraft(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          {row.origin === 'prestador' ? (
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!canAct || busy || !contractorId}
              onClick={() => generate.mutate({
                saleOrderId: row.sale_order_id,
                productId: row.product_id,
                strapM: strapNum,
                napaProductId: row.napa_product_id,
                contractorId: contractorId || null,
                laborCostPerM: row.labor_cost_per_m,
              })}
            >
              {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
              Gerar OC da napa e OS
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={
                !canAct
                || busy
                || !row.napa_product_id
                || !(Number(String(napaMDraft || suggestedNapa).replace(',', '.')) > 0)
              }
              onClick={() => {
                const napaM = Number(String(napaMDraft || suggestedNapa).replace(',', '.'));
                if (!row.napa_product_id || !(napaM > 0)) return;
                produce.mutate({
                  saleOrderId: row.sale_order_id,
                  productId: row.product_id,
                  strapM: strapNum,
                  napaProductId: row.napa_product_id,
                  napaM,
                });
              }}
            >
              {produce.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Factory className="h-3.5 w-3.5" />}
              Produzido
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function JobReceiveRow({ job }: { job: AtelierStrapJob }) {
  const receive = useRegisterAtelierStrapReceived();
  const [received, setReceived] = useState(String(job.pending_m || ''));
  const busy = receive.isPending;
  const receivedNum = Number(String(received).replace(',', '.')) || 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border border-border/60 bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">
          {job.order_number || 'PV'} · {job.product_name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Encomendado {fmt(job.strap_m)} m · recebido {fmt(job.received_m)} m · pendente{' '}
          {fmt(job.pending_m)} m
          {job.contractor_name ? ` · ${job.contractor_name}` : ''}
          {job.purchase_order_number ? (
            <> · OC {job.purchase_order_number} ({job.purchase_order_status})</>
          ) : null}
        </p>
      </div>
      <Input
        className="h-8 w-24 font-mono text-xs"
        inputMode="decimal"
        value={received}
        onChange={(e) => setReceived(e.target.value)}
        disabled={busy}
        aria-label="Metros recebidos"
      />
      <Button
        type="button"
        size="sm"
        className="h-8"
        disabled={busy || !(receivedNum > 0)}
        onClick={() => receive.mutate({
          jobId: job.id,
          receivedM: receivedNum,
          close: receivedNum >= job.pending_m - 1e-6,
        })}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
        Recebido
      </Button>
    </div>
  );
}

export function AtelierStrapsView() {
  const shortagesQ = useAtelierStrapShortages(true);
  const jobsQ = useAtelierStrapJobs(false, true);
  const { data: contractors = [] } = useContractors();

  const shortages = shortagesQ.data ?? [];
  const jobs = jobsQ.data ?? [];

  const { prestador, fabrica } = useMemo(() => {
    const p: AtelierStrapShortage[] = [];
    const f: AtelierStrapShortage[] = [];
    for (const row of shortages) {
      if (row.origin === 'prestador') p.push(row);
      else if (row.origin === 'fabrica') f.push(row);
    }
    return { prestador: p, fabrica: f };
  }, [shortages]);

  const openJobs = jobs.filter((j) => j.origin === 'prestador');
  const contractorOpts = (contractors as Array<{ id: string; name: string; active?: boolean }>)
    .filter((c) => c.active !== false)
    .map((c) => ({ id: c.id, name: c.name }));

  if (shortagesQ.isLoading || jobsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando faltas de tira…
      </div>
    );
  }

  if (shortagesQ.isError || jobsQ.isError) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar as tiras do Ateliê. Recarregue a página.
      </p>
    );
  }

  const empty = shortages.length === 0 && openJobs.length === 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Faltas de tira dos PVs aprovados. Prestador: gera OC da napa (entrega no prestador — não
        fica no estoque da fábrica) + OS de mão de obra; ao voltar, <strong>Recebido</strong> entra
        a tira. Fábrica: <strong>Produzido</strong> debita napa e entra a tira.
      </p>

      {empty ? (
        <EmptyState
          icon={Scissors}
          title="Nenhuma falta de tira"
          description="Quando um PV com tira de Fábrica ou Prestador for aprovado e faltar estoque, a falta aparece aqui."
        />
      ) : (
        <>
          {openJobs.length > 0 && (
            <Panel className="space-y-2 p-3">
              <h3 className="text-sm font-semibold">Prestador — receber tira</h3>
              <div className="space-y-1.5">
                {openJobs.map((job) => (
                  <JobReceiveRow key={job.id} job={job} />
                ))}
              </div>
            </Panel>
          )}

          {prestador.length > 0 && (
            <section className="space-y-2">
              <h3 className={cn('flex items-center gap-2 text-sm font-semibold')}>
                <Truck className="h-4 w-4 text-primary" />
                Prestador — gerar OC e OS
              </h3>
              <div className="space-y-2">
                {prestador.map((row) => (
                  <ShortageCard
                    key={`${row.sale_order_id}:${row.product_id}`}
                    row={row}
                    contractors={contractorOpts}
                  />
                ))}
              </div>
            </section>
          )}

          {fabrica.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Factory className="h-4 w-4 text-primary" />
                Fábrica — produzir
              </h3>
              <div className="space-y-2">
                {fabrica.map((row) => (
                  <ShortageCard
                    key={`${row.sale_order_id}:${row.product_id}`}
                    row={row}
                    contractors={contractorOpts}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Rendimento e origem padrão editam-se no{' '}
        <Link to="/estoque" className="underline underline-offset-2">
          grupo da tira no Estoque
        </Link>
        . OCs geradas ficam em Compras para aprovar/enviar.
      </p>
    </div>
  );
}
