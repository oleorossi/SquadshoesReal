/**
 * Prazos do motor — a tela que alimenta o motor de produção (fila + agenda +
 * compras automáticas). Cada número mostra onde o motor usa.
 * Fonte: get_motor_config / update_motor_settings.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleNotch as Loader2, Info } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMotorConfig, useUpdateMotorSettings } from '@/hooks/useMotorConfig';
import { ATELIER_SECTOR_LABEL, type AtelierSector } from '@/lib/atelier';
import {
  MOTOR_FIELDS,
  MOTOR_GATE_USED_FOR,
  parseMotorField,
  prepSourceLabel,
  type MotorFieldSpec,
  type MotorSettings,
} from '@/lib/motorConfig';

const GROUP_TITLE: Record<MotorFieldSpec['group'], string> = {
  prestador: 'Prestador · cabedal complexo',
  agenda: 'Agenda',
  compras: 'Compras automáticas',
};

function fieldText(settings: MotorSettings, spec: MotorFieldSpec): string {
  const v = settings[spec.key];
  return v == null ? '' : String(v);
}

function MotorField({ spec, settings, disabled, onSave }: {
  spec: MotorFieldSpec;
  settings: MotorSettings;
  disabled: boolean;
  onSave: (spec: MotorFieldSpec, value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = fieldText(settings, spec);
  const value = draft ?? current;
  const isDefault = (settings[spec.key] ?? null) === spec.defaultValue;

  const commit = () => {
    if (draft == null || draft.trim() === current) {
      setDraft(null);
      setError(null);
      return;
    }
    const parsed = parseMotorField(spec, draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setDraft(null);
    onSave(spec, parsed.value);
  };

  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,15rem)_8rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      <label htmlFor={`motor-${spec.key}`} className="pt-2 text-sm font-medium text-foreground">
        {spec.label}
        {!isDefault && (
          <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] font-normal">alterado</Badge>
        )}
      </label>
      <div>
        <div className="flex items-center gap-1.5">
          <Input
            id={`motor-${spec.key}`}
            inputMode="decimal"
            className={`h-9 w-24 text-right font-mono ${error ? 'border-destructive' : ''}`}
            disabled={disabled}
            value={value}
            placeholder={spec.nullable ? '—' : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setDraft(null); setError(null); }
            }}
            aria-invalid={error ? true : undefined}
          />
          <span className="text-[11px] text-muted-foreground">{spec.unit}</span>
        </div>
        {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      </div>
      <p className="pt-1.5 text-xs text-muted-foreground">
        {spec.usedFor}
        <span className="block text-[11px] text-muted-foreground/80">
          Padrão: {spec.defaultValue == null ? (spec.emptyMeaning ?? 'vazio') : `${spec.defaultValue} ${spec.unit}`}
          {spec.nullable && spec.emptyMeaning && spec.defaultValue != null ? ` · ${spec.emptyMeaning}` : ''}
        </span>
      </p>
    </div>
  );
}

export function MotorPrazosPanel() {
  const { data: config, isLoading, isError } = useMotorConfig();
  const update = useUpdateMotorSettings();

  if (isLoading) {
    return (
      <Panel className="flex justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Panel>
    );
  }
  if (isError || !config) {
    return <Panel className="p-4 text-sm text-destructive">Não foi possível carregar os prazos do motor.</Panel>;
  }

  const { settings, references, contractors, sectors } = config;
  const save = (spec: MotorFieldSpec, value: number | null) => update.mutate({ [spec.key]: value });
  const streetRefs = references.filter((r) => r.sector === 'costura_cabedal' || r.sector === 'aviamento');
  const refsWithoutPrep = streetRefs.filter((r) => r.prep_business_days == null);
  const refsWithoutContractor = streetRefs.filter((r) => r.default_execution_mode !== 'internal' && !r.default_contractor_id);
  const contractorsWithoutCapacity = contractors.filter((c) => c.active && c.capacity_pairs_per_day == null);
  const enabledSectors = sectors.filter((s) => s.enabled !== false);

  return (
    <Panel className="space-y-5 p-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prazos do motor</p>
        <p className="text-sm text-muted-foreground">
          Estes números alimentam a ordem única da fila, a agenda por setor e as OCs em rascunho que o motor cria ao
          aprovar um PV com cabedal complexo. Mudou aqui, vale no próximo recálculo da agenda. OC de verdade continua
          só pelo clique em <span className="font-medium text-foreground">Gerar OC</span>.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
          <Badge variant="outline" className="font-normal">
            Motor automático: {settings.auto_motor_enabled ? 'ligado' : 'desligado'}
          </Badge>
          <Badge variant="outline" className="font-normal">
            Liberar urgente sem material: {settings.urgent_release_without_material ? 'ligado' : 'desligado'}
          </Badge>
          <span className="text-muted-foreground">Chaves decididas pelo Leonardo — não mudam por esta tela.</span>
        </div>
      </header>

      {(refsWithoutPrep.length > 0 || refsWithoutContractor.length > 0 || contractorsWithoutCapacity.length > 0) && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">Cadastro a completar para o motor ficar exato</p>
            {refsWithoutPrep.length > 0 && (
              <p>{refsWithoutPrep.length} referência(s) complexa(s) sem prazo próprio — usam {settings.effective_default_prep_business_days} dias úteis ({prepSourceLabel({ prep_business_days: null }, settings)}).</p>
            )}
            {refsWithoutContractor.length > 0 && (
              <p>{refsWithoutContractor.length} referência(s) sem prestador padrão — a capacidade do prestador não entra na data.</p>
            )}
            {contractorsWithoutCapacity.length > 0 && (
              <p>{contractorsWithoutCapacity.length} prestador(es) sem pares/dia — o motor considera sem limite.</p>
            )}
          </div>
        </div>
      )}

      {(['prestador', 'agenda', 'compras'] as const).map((group) => (
        <section key={group} className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{GROUP_TITLE[group]}</h3>
          {MOTOR_FIELDS.filter((f) => f.group === group).map((spec) => (
            <MotorField key={spec.key} spec={spec} settings={settings} disabled={update.isPending} onSave={save} />
          ))}
          {group === 'agenda' && (
            <div className="grid gap-1 sm:grid-cols-[minmax(0,15rem)_8rem_minmax(0,1fr)] sm:items-start sm:gap-3">
              <span className="pt-2 text-sm font-medium text-foreground">Setor que espera o cabedal</span>
              <Select
                value={settings.motor_cabedal_gate_sector}
                disabled={update.isPending}
                onValueChange={(v) => update.mutate({ motor_cabedal_gate_sector: v })}
              >
                <SelectTrigger className="h-9 w-32 text-xs" aria-label="Setor que espera o cabedal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabledSectors.map((s) => (
                    <SelectItem key={s.sector} value={s.sector}>{s.sector}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="pt-1.5 text-xs text-muted-foreground">
                {MOTOR_GATE_USED_FOR}
                <span className="block text-[11px] text-muted-foreground/80">Padrão: Montagem</span>
              </p>
            </div>
          )}
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Referências complexas · prazo que o motor usa</h3>
        {streetRefs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma referência de Costura/Aviamento no Ateliê.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Referência</th>
                  <th className="px-3 py-2 font-medium">Setor</th>
                  <th className="px-3 py-2 text-right font-medium">Prazo (dias úteis)</th>
                  <th className="px-3 py-2 font-medium">Origem do prazo</th>
                  <th className="px-3 py-2 font-medium">Prestador padrão</th>
                  <th className="px-3 py-2 text-right font-medium">Pares/dia</th>
                </tr>
              </thead>
              <tbody>
                {streetRefs.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">{r.reference_code ?? '—'}</td>
                    <td className="px-3 py-1.5">{ATELIER_SECTOR_LABEL[r.sector as AtelierSector] ?? r.sector}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.effective_prep_business_days ?? '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{prepSourceLabel(r, settings)}</td>
                    <td className="px-3 py-1.5">
                      {r.default_execution_mode === 'internal' ? 'Interno' : (r.default_contractor_name ?? <span className="text-amber-600">sem prestador</span>)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.contractor_capacity_pairs_per_day ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          O prazo próprio e o prestador padrão de cada referência ficam na lista abaixo; a capacidade (pares/dia) fica
          em "Prestadores de costura/aviamento". Capacidade cheia empurra o envio e a volta prevista.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Setores da fábrica · ordem do fluxo e capacidade</h3>
        <div className="flex flex-wrap gap-1.5">
          {enabledSectors.map((s) => (
            <Badge key={s.sector} variant="outline" className="font-normal">
              {s.flow_order ?? '—'} · {s.sector} · {s.daily_capacity_pairs ?? '—'} pares/dia
            </Badge>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          A agenda usa a ordem e a capacidade diária de cada setor (e o ritmo da ficha técnica quando existe).
          Editar em <Link className="underline" to="/producao/setores">Produção › Setores</Link>.
        </p>
      </section>
    </Panel>
  );
}

/** Resumo de uma linha para a aba Corte — leva para a tela completa. */
export function MotorPrazosResumo() {
  const { data: config } = useMotorConfig();
  if (!config) return null;
  const s = config.settings;
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs text-muted-foreground">
      <span>
        Prazos do motor: prestador {s.effective_default_prep_business_days} dias úteis · pronto {s.ready_before_billing_days} dias
        antes do faturamento · lead de OC {s.default_oc_lead_days} dias · {s.motor_cabedal_gate_sector} espera o cabedal
      </span>
      <Link className="font-medium text-foreground underline" to="/terceirizados?tab=modelos">Ajustar prazos do motor</Link>
    </Panel>
  );
}
