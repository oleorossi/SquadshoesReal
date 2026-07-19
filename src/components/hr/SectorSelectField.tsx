// Setor do funcionário como LISTA canônica (specs/equipe-e-capacidade-fonte-unica.md, R8/R9).
//
// O campo era <Input> de texto livre — foi assim que surgiram 7 funcionários sem
// setor e 2 num genérico "Produção", que não somam em contagem nenhuma e fizeram
// a Costura parecer não cadastrada. Aqui ele vira seleção dos setores de produção
// + áreas de apoio, com criação guiada: ao criar um setor novo o sistema pergunta
// se é de produção (entra na capacidade, no fluxo e nas fichas) ou se fica só no
// RH para folha e ponto.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, CircleNotch as Loader2 } from "@phosphor-icons/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Áreas que não são de produção — vivem só no RH, sem efeito em capacidade. */
export const AREAS_APOIO = ["Administrativo", "Comercial", "Terceirizado"] as const;

async function listProductionSectors(): Promise<string[]> {
  const { data, error } = await (supabase as any)
    .from("sector_settings")
    .select("sector, flow_order")
    .order("flow_order");
  if (error) throw error;
  return (data ?? []).map((r: { sector: string }) => r.sector);
}

export interface SectorSelectFieldProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function SectorSelectField({ value, onChange, disabled }: SectorSelectFieldProps) {
  const qc = useQueryClient();
  const [criarOpen, setCriarOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [ehProducao, setEhProducao] = useState(false);
  const [depoisDe, setDepoisDe] = useState<string>("");
  const [paralelo, setParalelo] = useState(false);
  const [custoHora, setCustoHora] = useState("");

  const { data: produtivos } = useQuery({
    queryKey: ["production-sectors"],
    queryFn: listProductionSectors,
    staleTime: 5 * 60_000,
  });

  const opcoes = useMemo(() => {
    const base = [...(produtivos ?? []), ...AREAS_APOIO];
    // Mantém o valor atual na lista mesmo se estiver fora do padrão, para não
    // apagar silenciosamente o cadastro de quem ainda não foi reclassificado.
    if (value && !base.includes(value)) base.push(value);
    return base;
  }, [produtivos, value]);

  const criar = useMutation({
    mutationFn: async () => {
      const nomeLimpo = nome.trim();
      if (!nomeLimpo) throw new Error("Informe o nome do setor");
      if (opcoes.includes(nomeLimpo)) throw new Error("Já existe um setor com esse nome");

      if (!ehProducao) {
        // Área de apoio: não entra em sector_settings, é só rótulo de RH (R9).
        return nomeLimpo;
      }

      const rate = custoHora.trim() === "" ? 0 : Number(custoHora.replace(",", "."));
      if (!Number.isFinite(rate) || rate < 0) throw new Error("Custo-hora inválido");

      const { data, error } = await (supabase as any).rpc("create_production_sector", {
        p_sector: nomeLimpo,
        p_after_sector: depoisDe || null,
        p_parallel: paralelo,
        p_hourly_rate: rate,
      });
      if (error) throw error;
      return (data as { sector: string })?.sector ?? nomeLimpo;
    },
    onSuccess: (novo) => {
      toast.success(
        ehProducao
          ? `Setor ${novo} criado — já vale na capacidade e no fluxo de produção`
          : `Área ${novo} criada — fica só no RH, sem efeito na capacidade`,
      );
      onChange(novo);
      setCriarOpen(false);
      setNome("");
      setEhProducao(false);
      setDepoisDe("");
      setParalelo(false);
      setCustoHora("");
      qc.invalidateQueries({ queryKey: ["production-sectors"] });
      qc.invalidateQueries({ queryKey: ["sector-team"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Label>Setor</Label>
      <div className="flex gap-2">
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Selecione o setor" />
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          title="Criar setor novo"
          onClick={() => setCriarOpen(true)}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={criarOpen} onOpenChange={setCriarOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo setor</DialogTitle>
            <DialogDescription>
              Setor de produção entra na capacidade, no fluxo e nas fichas técnicas. Área de apoio
              fica só no RH, para folha e ponto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Manutenção"
              />
            </div>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm">É setor de produção?</span>
              <Switch checked={ehProducao} onCheckedChange={setEhProducao} />
            </label>

            {ehProducao && (
              <div className="space-y-3 rounded-md bg-muted/40 p-3">
                <div>
                  <Label className="text-xs">Vem depois de qual setor?</Label>
                  <Select value={depoisDe || undefined} onValueChange={setDepoisDe}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="No fim do fluxo" />
                    </SelectTrigger>
                    <SelectContent>
                      {(produtivos ?? []).map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-xs">Roda em paralelo com o setor anterior?</span>
                  <Switch checked={paralelo} onCheckedChange={setParalelo} />
                </label>
                <div>
                  <Label className="text-xs">Custo-hora (R$)</Label>
                  <Input
                    inputMode="decimal"
                    className="mt-1 font-mono text-right"
                    value={custoHora}
                    onChange={(e) => setCustoHora(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCriarOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              {criar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
