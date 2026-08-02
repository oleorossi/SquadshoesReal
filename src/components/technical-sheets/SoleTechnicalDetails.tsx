import { useState, useEffect, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footprints, FloppyDisk as Save, CircleNotch as Loader2, Stack as Layers, Shield, Plus, X, Copy, Info, Link as Link2, Warning as AlertTriangle, CaretDown as ChevronDown } from '@phosphor-icons/react';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { searchMatchesAllTerms } from "@/lib/searchUtils";
import { SearchInput } from "@/components/ui/search-input";
import { SoleConjugationPanel } from "@/components/inventory/SoleConjugationPanel";
import { CopyFromAnySoleDialog } from "./CopyFromAnySoleDialog";
import { useSoleConjugations } from "@/hooks/useSoleConjugations";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Grade de numerações do solado + materiais default.
 *
 * ⚠ ESTA TELA NÃO CADASTRA CONSUMO. Desde 02/08/2026 a fonte da verdade é
 * `sole_group_standard_items` (linhas PAPEL, por MODELO de solado), editada em
 * **Solados → Consumo Padrão**; `sole_technical_specs` é ESPELHO derivado,
 * mantido pelo trigger `tg_sgsi_mirror_papel`.
 *
 * Em 03/08/2026 as 4 colunas de consumo saíram daqui de vez. O `readOnly` que
 * existia antes cobria só os `<input>` — "Replicar 1º valor", "Puxar de
 * Família", "Copiar de Qualquer Solado" e o próprio Salvar continuavam
 * gravando no espelho, e o próximo salvamento em Consumo Padrão apagava sem
 * avisar. Tela única de consumo = Consumo Padrão; aqui mora só a GRADE.
 *
 * Uma trava no banco (migration 20261104120000) rejeita alteração dessas
 * colunas vinda de fora do espelho — a guarda não depende mais só desta tela.
 */
interface SoleTechnicalDetailsProps {
  soleId: string;
  soleName?: string;
  onClose?: () => void;
}

// NOTA (auditoria 2026-06-29): os presets de numeração (Adulto/Infantil/Baby) e a
// função getSortedPresets foram removidos junto com os botões de preset do Passo 2.
// A grade hoje vem do range (size_from/size_to) definido na aba Cadastro — ver o
// comentário do Passo 2 abaixo. Mantê-los aqui era código morto.

export function SoleTechnicalDetails({ soleId, soleName, onClose }: SoleTechnicalDetailsProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [sizes, setSizes] = useState<number[]>([]);
  const [newSize, setNewSize] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [liningGroupId, setLiningGroupId] = useState<string | null>(null);
  const [insoleGroupId, setInsoleGroupId] = useState<string | null>(null);
  const [liningMaterialId, setLiningMaterialId] = useState<string | null>(null);
  const [insoleMaterialId, setInsoleMaterialId] = useState<string | null>(null);
  const [liningSearch, setLiningSearch] = useState("");
  const [insoleSearch, setInsoleSearch] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [isReferenceLoading, setIsReferenceLoading] = useState(false);
  const [referencePreview, setReferencePreview] = useState<any | null>(null);
  const [referenceInfo, setReferenceInfo] = useState<{ id: string; name: string; date: string } | null>(null);
  const [copyAnyOpen, setCopyAnyOpen] = useState(false);
  const [soleGroupId, setSoleGroupId] = useState<string | null>(null);
  /**
   * Faixa de numeração do PRÓPRIO solado (stock_grade._size_from/_to) — a mesma
   * fonte que alimenta a grade do PV. É a régua correta destas specs.
   *
   * Bug 01/08/2026: `confirmPull` copiava os tamanhos da REFERÊNCIA sem olhar
   * esta faixa, então solado infantil que puxou de um adulto ficou com specs em
   * 34–40. Os 11 solados com specs do sistema estavam TODOS em 34–40 por isso —
   * todos descendem do mesmo molde. No SOLADO INFANTIL (faixa 23–36) sobrava
   * um único número em comum, e o consumo dos outros caía na média escalar ou
   * contava ZERO, silenciosamente.
   */
  const [soleRange, setSoleRange] = useState<{ from: number; to: number } | null>(null);
  /** Espelho em ref: `fetchAll` corre em paralelo com a query que lê a faixa. */
  const soleRangeRef = useRef<{ from: number; to: number } | null>(null);
  /** Expande a faixa do solado em números individuais. */
  const rangeSizes = (r: { from: number; to: number } | null): number[] => {
    if (!r) return [];
    const out: number[] = [];
    for (let s = r.from; s <= r.to; s++) out.push(s);
    return out;
  };
  const [soleClassification, setSoleClassification] = useState<'tradicional' | 'palmilha_pronta' | 'conjugado' | null>(null);
  const [isFachetado, setIsFachetado] = useState<boolean>(false);
  // Solado de palmilha pronta vem forrado do fornecedor — palmilha conta como
  // UN, não dm². Usado só pra rotular a UI; o consumo em si é do Consumo Padrão.
  const isPalmilhaPronta = soleClassification === 'palmilha_pronta';
  // Passo 3 (Materiais padrão) é opcional — escondemos por default pra não
  // competir visualmente com a grade. User pode expandir se quiser configurar
  // material default.
  const [showDefaultMaterials, setShowDefaultMaterials] = useState<boolean>(false);

  // Conjugações vinculadas ao GRUPO do solado
  const { data: conjugations = [] } = useSoleConjugations(soleGroupId);

  /**
   * Mapa size→size_key conjugado. Ex: 33→"33/34", 34→"33/34", 35→null.
   * Usado pra renderizar badges visuais e agrupar tamanhos conjugados.
   */
  const sizeToConjKey = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of conjugations) {
      for (const s of c.sizes) m.set(s, c.size_key);
    }
    return m;
  }, [conjugations]);

  useEffect(() => {
    if (soleId) {
      fetchAll().then((hasData) => {
        if (!hasData && soleName) {
          tryLoadReferenceSpecs(soleName, true);
        }
      });
      fetchMetadata();
      supabase
        .from('products')
        .select('group_id, is_fachetado, name, stock_grade, sole_classification')
        .eq('id', soleId)
        .single()
        .then(({ data }) => {
          const d = data as any;
          if (d?.group_id) setSoleGroupId(d.group_id);
          setIsFachetado((data as any)?.is_fachetado ?? false);
          setSoleClassification((data as any)?.sole_classification ?? null);
          // Auto-popula `sizes` a partir do range definido na aba Cadastro
          // (stock_grade._size_from / _size_to). Antes essa seção ficava vazia
          // quando o solado não tinha sole_technical_specs, e o user tinha
          // que adicionar manualmente — agora vem direto do range. Por user
          // request: "deve aparecer apenas os números iniciais até o número
          // final que eu trabalho".
          const grade = d?.stock_grade as Record<string, any> | null;
          if (grade && (grade._size_from != null || grade._size_to != null)) {
            const from = Number(grade._size_from);
            const to = Number(grade._size_to);
            if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
              setSoleRange({ from, to });
              soleRangeRef.current = { from, to };
              // A faixa do solado SEMPRE aparece — mesmo quando já existem specs
              // em outra régua. Antes o guard `prev.length > 0` fazia a tela
              // mostrar só os tamanhos das specs, então um solado 23–36 com
              // specs herdadas em 34–40 nunca exibia 23–33: não havia onde
              // digitar o consumo dos números que a fábrica realmente vende.
              setSizes(prev => {
                const all = new Set<number>(prev);
                for (let s = from; s <= to; s++) all.add(s);
                return Array.from(all).sort((a, b) => a - b);
              });
            }
          }
        });
    }
  }, [soleId]);

  const fetchMetadata = async () => {
    const [{ data: groupData }, { data: productData }] = await Promise.all([
      supabase.from("product_groups").select("id, name").order("name"),
      supabase.from("products").select("id, name, category, color").order("name")
    ]);
    if (groupData) setGroups(groupData);
    if (productData) setProducts(productData);
  };

  const fetchAll = async (): Promise<boolean> => {
    const [{ data: specsData }, { data: structData }] = await Promise.all([
      supabase.from("sole_technical_specs").select("*").eq("sole_id", soleId).order("size"),
      supabase.from("sole_structures").select("*").eq("sole_id", soleId),
    ]);

    if (specsData && specsData.length > 0 && specsData[0].reference_sole_id) {
      const { data: refSole } = await supabase
        .from('products')
        .select('name')
        .eq('id', specsData[0].reference_sole_id)
        .single();

      if (refSole) {
        setReferenceInfo({
          id: specsData[0].reference_sole_id,
          name: refSole.name,
          date: new Date(specsData[0].reference_date).toLocaleString('pt-BR')
        });
      }
    }

    const loadedSizes = (specsData || []).map((r: any) => Number(r.size)).sort((a, b) => a - b);
    // União com a faixa do solado: quem tem spec aparece (mesmo fora da faixa,
    // pra poder ser removido) e quem está na faixa aparece (mesmo sem spec, pra
    // poder ser preenchido). Antes era `setSizes(loadedSizes)` puro, e com specs
    // herdadas de outra régua a tela nunca mostrava os números reais do solado.
    setSizes(Array.from(new Set([...loadedSizes, ...rangeSizes(soleRangeRef.current)]))
      .sort((a, b) => a - b));

    // As colunas de consumo não são lidas nem escritas aqui — pertencem ao
    // Consumo Padrão (por modelo). Desta tabela só interessa quais numerações
    // existem, pra montar a grade.

    if (structData) {
      const lining = structData.find((d: any) => d.component_type === "Forro");
      const insole = structData.find((d: any) => d.component_type === "Palmilha");
      if (lining) {
        setLiningGroupId(lining.default_group_id);
        setLiningMaterialId((lining as any).lining_material_id);
      }
      if (insole) {
        setInsoleGroupId(insole.default_group_id);
        setInsoleMaterialId((insole as any).insole_material_id);
      }
    }

    return (specsData || []).length > 0;
  };

  const tryLoadReferenceSpecs = async (currentName: string, silent = false) => {
    if (!currentName || isReferenceLoading) return;
    const baseName = currentName.split(" - ")[0];
    if (!baseName) return;

    if (!silent) setIsReferenceLoading(true);

    try {
      const { data: otherSoles } = await supabase
        .from("products")
        .select("id")
        .eq("category", "Solado")
        .neq("id", soleId)
        .ilike("name", `${baseName}%`);

      if (!otherSoles || otherSoles.length === 0) {
        if (!silent) toast.info("Nenhuma referência anterior encontrada para este solado.");
        return;
      }

      const otherIds = otherSoles.map(s => s.id);

      const { data: recentSpecs } = await supabase
        .from("sole_technical_specs")
        .select("*")
        .in("sole_id", otherIds)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (!recentSpecs || recentSpecs.length === 0) {
        if (!silent) toast.info("Nenhuma especificação preenchida encontrada em referências similares.");
        return;
      }

      const mostRecentSoleId = recentSpecs[0].sole_id;
      const filteredSpecs = recentSpecs.filter(s => s.sole_id === mostRecentSoleId);

      const { data: refProd } = await supabase.from('products').select('name').eq('id', mostRecentSoleId).single();
      const refName = refProd?.name || baseName;

      setReferencePreview({
        soleId: mostRecentSoleId,
        name: refName,
        date: new Date(recentSpecs[0].updated_at || recentSpecs[0].created_at).toLocaleString('pt-BR'),
        specs: filteredSpecs,
        baseName
      });
    } catch (err) {
      console.error("Erro ao carregar referência:", err);
      if (!silent) toast.error("Falha ao buscar dados da referência.");
    } finally {
      if (!silent) setIsReferenceLoading(false);
    }
  };

  const confirmPull = async () => {
    if (!referencePreview) return;

    const { specs: allRefSpecs, soleId: refSoleId, name: refName, date: refDate } = referencePreview;

    // A numeração da REFERÊNCIA não é a deste solado. Copiar a régua junto com
    // os valores foi o que espalhou 34–40 por todos os solados do sistema —
    // inclusive os infantis, cuja faixa real é 23–36 (bug 01/08/2026).
    // Importa só o que cai dentro da faixa DESTE solado; sem faixa cadastrada,
    // mantém o comportamento antigo (não há régua pra respeitar).
    const range = soleRangeRef.current;
    const filteredSpecs = range
      ? allRefSpecs.filter((r: any) => {
          const s = Number(r.size);
          return Number.isFinite(s) && s >= range.from && s <= range.to;
        })
      : allRefSpecs;
    const descartados = allRefSpecs.length - filteredSpecs.length;

    if (range && filteredSpecs.length === 0) {
      toast.error(
        `"${refName}" tem consumo só de ${Math.min(...allRefSpecs.map((r: any) => Number(r.size)))}` +
        `–${Math.max(...allRefSpecs.map((r: any) => Number(r.size)))}, fora da faixa deste solado ` +
        `(${range.from}–${range.to}). Nada foi copiado.`,
      );
      return;
    }

    // Faixa do solado sempre visível: os números sem valor na referência ficam
    // em branco pra preencher, em vez de sumirem da tela.
    const loadedSizes = Array.from(new Set([
      ...filteredSpecs.map((r: any) => Number(r.size)),
      ...rangeSizes(range),
    ])).sort((a, b) => a - b);
    setSizes(loadedSizes);

    if (descartados > 0) {
      toast.warning(
        `${descartados} ${descartados === 1 ? 'numeração ficou' : 'numerações ficaram'} de fora: ` +
        `estão além da faixa ${range!.from}–${range!.to} deste solado.`,
      );
    }

    // Só a RÉGUA é copiada. Os valores de consumo da referência ficam de fora
    // desde 03/08/2026: quem os cadastra é Consumo Padrão, por modelo. Copiar
    // aqui gravava no espelho e era apagado no salvamento seguinte.

    const { data: structData } = await supabase
      .from("sole_structures")
      .select("*")
      .eq("sole_id", refSoleId);

    if (structData) {
      const lining = structData.find((d: any) => d.component_type === "Forro");
      const insole = structData.find((d: any) => d.component_type === "Palmilha");
      if (lining) {
        setLiningGroupId(lining.default_group_id);
        setLiningMaterialId((lining as any).lining_material_id);
      }
      if (insole) {
        setInsoleGroupId(insole.default_group_id);
        setInsoleMaterialId((insole as any).insole_material_id);
      }
    }

    setReferenceInfo({ id: refSoleId, name: refName, date: refDate });
    setReferencePreview(null);
    toast.success(`Numerações carregadas da referência: ${refName}`);
  };

  const addSize = () => {
    const n = parseInt(newSize.trim(), 10);
    if (!n || n < 10 || n > 60) { toast.error("Numeração inválida (10–60)"); return; }
    if (sizes.includes(n)) { toast.error("Numeração já adicionada"); return; }
    setSizes([...sizes, n].sort((a, b) => a - b));
    setNewSize("");
  };

  const removeSize = (size: number) => {
    setSizes((prev) => prev.filter((s) => s !== size));
  };

  const handleSave = async () => {
    if (sizes.length === 0) { toast.error("Defina ao menos uma numeração"); return; }

    setSaving(true);
    try {
      // Só a GRADE é gravada. As colunas de consumo ficam de fora do payload:
      // pertencem ao Consumo Padrão e são preenchidas pelo trigger de espelho.
      // Enviá-las aqui — mesmo com o valor atual — colidiria com a trava
      // `tg_sole_specs_freeze_consumption` no primeiro arredondamento.
      const dataToUpsert = sizes.map((size) => ({
        sole_id: soleId,
        size,
        reference_sole_id: referenceInfo?.id || null,
        reference_date: referenceInfo ? new Date().toISOString() : null
      }));
      const { error: specsError } = await supabase
        .from("sole_technical_specs")
        .upsert(dataToUpsert, { onConflict: "sole_id,size" });
      if (specsError) throw specsError;

      // ── Espelha a GRADE pra TODAS as cores do mesmo solado ──
      // Conforme decisão do usuário: "Pasta de solados, para consumo e
      // definições técnicas é indiferente a cor do solado, isso só faz
      // diferença pra combinação de cabedal".
      // Buscamos todos products com o mesmo group_id (variantes de cor do
      // mesmo solado) e replicamos as numerações pra cada um. Cor é só pra
      // estoque/expedição — a régua é do modelo.
      if (soleGroupId) {
        const { data: siblings } = await supabase
          .from("products")
          .select("id")
          .eq("group_id", soleGroupId)
          .neq("id", soleId);

        for (const sibling of (siblings || [])) {
          const siblingData = sizes.map(size => ({
            sole_id: sibling.id,
            size,
            reference_sole_id: referenceInfo?.id || null,
            reference_date: referenceInfo ? new Date().toISOString() : null
          }));
          await supabase
            .from("sole_technical_specs")
            .upsert(siblingData, { onConflict: "sole_id,size" });

          // Limpa specs de tamanhos removidos da grade nos siblings também
          const { data: existingSibling } = await supabase
            .from("sole_technical_specs")
            .select("size")
            .eq("sole_id", sibling.id);
          const toDeleteSibling = (existingSibling || [])
            .map((r: any) => r.size)
            .filter((s: number) => !sizes.includes(s));
          if (toDeleteSibling.length > 0) {
            await supabase
              .from("sole_technical_specs")
              .delete()
              .eq("sole_id", sibling.id)
              .in("size", toDeleteSibling);
          }
        }
      }

      const { data: existing } = await supabase
        .from("sole_technical_specs")
        .select("size")
        .eq("sole_id", soleId);
      const existingSizes = (existing || []).map((r: any) => r.size);
      const toDelete = existingSizes.filter((s: number) => !sizes.includes(s));
      if (toDelete.length > 0) {
        await supabase
          .from("sole_technical_specs")
          .delete()
          .eq("sole_id", soleId)
          .in("size", toDelete);
      }

      const structuresToUpsert = [];
      if (liningGroupId || liningMaterialId) {
        structuresToUpsert.push({
          sole_id: soleId,
          component_type: "Forro",
          default_group_id: liningGroupId,
          lining_material_id: liningMaterialId
        });
      }
      if (insoleGroupId || insoleMaterialId) {
        structuresToUpsert.push({
          sole_id: soleId,
          component_type: "Palmilha",
          default_group_id: insoleGroupId,
          insole_material_id: insoleMaterialId
        });
      }
      if (structuresToUpsert.length > 0) {
        const { error: structError } = await supabase
          .from("sole_structures")
          .upsert(structuresToUpsert, { onConflict: "sole_id,component_type" });
        if (structError) throw structError;

        // Espelha sole_structures pras outras cores do mesmo solado
        // (mesma justificativa do espelhamento de sole_technical_specs).
        if (soleGroupId) {
          const { data: siblings2 } = await supabase
            .from("products")
            .select("id")
            .eq("group_id", soleGroupId)
            .neq("id", soleId);
          for (const sibling of (siblings2 || [])) {
            const siblingStructs = structuresToUpsert.map(s => ({ ...s, sole_id: sibling.id }));
            await supabase
              .from("sole_structures")
              .upsert(siblingStructs, { onConflict: "sole_id,component_type" });
          }
        }
      }

      qc.invalidateQueries({ queryKey: ["sole_size_grade", soleId] });
      toast.success("Grade de numerações salva!");
      if (onClose) onClose(); else window.history.back();
    } catch (error: any) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Visibilidade do conjugation panel: depende do soleGroupId.
   */
  const conjugationCount = conjugations.length;
  const conjugatedSizesCount = conjugations.reduce((sum, c) => sum + c.sizes.length, 0);

  // Listas filtradas dos seletores de material default (Passo 3).
  const filteredLiningProducts = products.filter((p) => searchMatchesAllTerms(liningSearch, p.name, p.category, p.color));
  const filteredInsoleProducts = products.filter((p) => searchMatchesAllTerms(insoleSearch, p.name, p.category, p.color));

  return (
    <div className="space-y-5">
      {/* ─── Header (referência + ações) ─────────────────────────── */}
      {referenceInfo && (
        <div className="bg-primary/8 border border-primary/20 p-2 rounded text-xs text-primary flex items-center gap-2">
          <Info className="h-4 w-4" />
          <span>Baseado na referência: <strong>{referenceInfo.name}</strong> em {referenceInfo.date}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Footprints className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Grade de Numerações</h2>
            <p className="text-sm text-muted-foreground">
              {soleName || "Solado"} — o consumo por par fica em <strong>Consumo Padrão</strong>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => soleName && tryLoadReferenceSpecs(soleName)}
            disabled={saving || isReferenceLoading || !soleName}
            className="gap-2 shrink-0 border-blue-500/30 hover:border-blue-500/60 text-blue-600 bg-blue-500/10"
            title="Tenta achar a régua de numerações de outro solado com nome similar (mesma família)"
          >
            {isReferenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Puxar de Família
          </Button>
          <Button
            variant="outline"
            onClick={() => setCopyAnyOpen(true)}
            disabled={saving}
            className="gap-2 shrink-0 border-purple-500/30 hover:border-purple-500/60 text-purple-600 bg-purple-500/10"
            title="Usa a régua de qualquer solado já cadastrado como base — você ajusta depois"
          >
            <Copy className="h-4 w-4" />
            Copiar Numerações de Outro Solado
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2 shrink-0">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </div>

      {/* ─── Passo 1: Conjugação de numerações ─────────────────────
          20/05/2026: removida a restrição de tipo. Qualquer solado (Tradicional,
          Palmilha Pronta ou Conjugado) pode ter conjugações cadastradas — user
          precisava de 33/34 e 39/40 em Palmilha Pronta e ficava preso. O tipo
          continua existindo (afeta cor de palmilha automática) mas não
          restringe mais. */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
            <Link2 className="h-4 w-4 text-primary" />
            Numerações conjugadas
            <Badge variant="outline" className="text-xs">
              Tipo: {soleClassification === 'palmilha_pronta' ? 'Palmilha Pronta' : soleClassification === 'conjugado' ? 'Conjugado' : 'Tradicional'}
            </Badge>
            {conjugationCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {conjugationCount} regra{conjugationCount === 1 ? '' : 's'} · {conjugatedSizesCount} tam.
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Marque tamanhos que <strong>compartilham o mesmo molde</strong> (ex: 33/34, 39/40).
            O estoque, o débito do PV e o planejamento de compra usam essas chaves automaticamente.
            Tamanhos sem conjugação são tratados como individuais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {soleGroupId ? (
            <SoleConjugationPanel soleGroupId={soleGroupId} soleName={soleName} />
          ) : (
            <div className="text-xs text-muted-foreground italic py-4 text-center">
              Solado sem grupo associado — vincule a um grupo pela aba <strong>Cadastro</strong> pra configurar conjugações.
            </div>
          )}
        </CardContent>
      </Card>
      {/* ─── Passo 2: Grade de numerações ──────────────────────────
          User feedback: o range já é definido no Cadastro (size_from/size_to).
          Removidos os preset buttons (Adulto/Infantil/Baby) — eram duplicação.
          O card agora mostra só o resumo dos tamanhos cadastrados e o input
          de "adicionar tamanho avulso" como escape hatch pra casos especiais
          (ex.: solado com pula numeração).
      */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-foreground text-xs font-bold">2</span>
            Grade de numerações
            {sizes.length > 0 && (
              <Badge variant="outline" className="text-xs ml-1">
                {sizes.length} tam. · {sizes[0]}–{sizes[sizes.length - 1]}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Numerações que o solado trabalha — derivadas automaticamente do range
            (numeração inicial → final) definido na aba <strong>Cadastro</strong>.
            O consumo por par de cada uma fica em <strong>Consumo Padrão</strong>,
            cadastrado por modelo e válido pra todas as cores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Numeração fora da faixa do solado: veio de cópia de referência de
              outra régua (bug 01/08/2026, ver soleRange). Não some sozinha —
              o valor pode ser legítimo — mas precisa ser visto, porque o PV
              nunca vende esses números. */}
          {soleRange && sizes.some(s => s < soleRange.from || s > soleRange.to) && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>
                  {sizes.filter(s => s < soleRange.from || s > soleRange.to).join(', ')}
                </strong>{' '}
                {sizes.filter(s => s < soleRange.from || s > soleRange.to).length === 1
                  ? 'está fora' : 'estão fora'} da faixa deste solado
                (<strong>{soleRange.from}–{soleRange.to}</strong>, definida na aba Cadastro).
                O PV não vende {sizes.filter(s => s < soleRange.from || s > soleRange.to).length === 1 ? 'esse número' : 'esses números'} —
                costuma ser resquício de cópia de outro solado. Remova a numeração, ou corrija a faixa no Cadastro.
              </span>
            </div>
          )}

          {sizes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sizes.map((s) => {
                const conjKey = sizeToConjKey.get(s);
                return (
                  <span
                    key={s}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-mono border ${
                      conjKey
                        ? 'bg-primary/15 border-primary/50 text-primary font-bold'
                        : 'bg-background border-border'
                    }`}
                    title={conjKey ? `Numeração ${s} faz parte da conjugada "${conjKey}"` : 'Numeração individual'}
                  >
                    {conjKey && <Link2 className="h-3.5 w-3.5" />}
                    {s}
                    <button onClick={() => removeSize(s)} className="ml-0.5 text-muted-foreground hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 max-w-xs">
            <Input
              placeholder="Adicionar tamanho avulso (ex: 41)"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSize()}
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addSize}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Passo 3: Materiais padrão — OPCIONAL (colapsável fechado) ───
          Renomeado pra "Material default" + Badge "Opcional" + colapsável fechado.
          É só sugestão de qual produto usar quando o PV não escolher — a
          QUANTIDADE consumida vive em Consumo Padrão, por modelo.
      */}
      <Card className="border-dashed">
        <button
          type="button"
          onClick={() => setShowDefaultMaterials(!showDefaultMaterials)}
          className="w-full text-left"
        >
          <CardHeader className="pb-2 hover:bg-muted/20 transition-colors">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold">3</span>
              Material default (opcional)
              <Badge variant="outline" className="text-xs h-4 ml-1 bg-muted/30 text-muted-foreground border-muted">
                Configuração avançada
              </Badge>
              <ChevronDown className={`h-4 w-4 ml-auto text-muted-foreground transition-transform ${showDefaultMaterials ? 'rotate-180' : ''}`} />
            </CardTitle>
            <CardDescription className="text-xs">
              Material sugerido pra forração/palmilha QUANDO o PV não trouxer um override.
              {' '}<strong>Não afeta consumo</strong> — o cálculo de dm² vem da aba <strong>Consumo Padrão</strong>.
            </CardDescription>
          </CardHeader>
        </button>
        {showDefaultMaterials && (
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-purple-600" /> Material — Forração
              </Label>
              <div className="flex flex-col gap-2">
                <Select value={liningMaterialId || "none"} onValueChange={(v) => setLiningMaterialId(v === "none" ? null : v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecionar material específico…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <div className="p-2 sticky top-0 bg-popover z-10 border-b">
                      <SearchInput
                        value={liningSearch}
                        onChange={setLiningSearch}
                        placeholder="Buscar por nome, categoria ou cor…"
                        resultCount={filteredLiningProducts.length}
                        totalCount={products.length}
                        inputClassName="h-7 text-xs"
                      />
                    </div>
                    <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                    {liningSearch.trim() && filteredLiningProducts.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center space-y-2">
                        <p>Nenhum resultado para "{liningSearch}"</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={(e) => { e.stopPropagation(); setLiningSearch(""); }}
                        >
                          Limpar busca
                        </Button>
                      </div>
                    ) : (
                      filteredLiningProducts
                        .slice(0, 100)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex flex-col">
                              <span className="text-xs">{p.name}</span>
                              <span className="text-xs text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                            </div>
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>

                {!liningMaterialId && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground ml-1">Ou selecione um grupo genérico:</Label>
                    <Select value={liningGroupId || "none"} onValueChange={(v) => setLiningGroupId(v === "none" ? null : v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecionar grupo…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-blue-600" /> Material — Palmilha
              </Label>
              <div className="flex flex-col gap-2">
                <Select value={insoleMaterialId || "none"} onValueChange={(v) => setInsoleMaterialId(v === "none" ? null : v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecionar material específico…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <div className="p-2 sticky top-0 bg-popover z-10 border-b">
                      <SearchInput
                        value={insoleSearch}
                        onChange={setInsoleSearch}
                        placeholder="Buscar por nome, categoria ou cor…"
                        resultCount={filteredInsoleProducts.length}
                        totalCount={products.length}
                        inputClassName="h-7 text-xs"
                      />
                    </div>
                    <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                    {insoleSearch.trim() && filteredInsoleProducts.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center space-y-2">
                        <p>Nenhum resultado para "{insoleSearch}"</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={(e) => { e.stopPropagation(); setInsoleSearch(""); }}
                        >
                          Limpar busca
                        </Button>
                      </div>
                    ) : (
                      filteredInsoleProducts
                        .slice(0, 100)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex flex-col">
                              <span className="text-xs">{p.name}</span>
                              <span className="text-xs text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                            </div>
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>

                {!insoleMaterialId && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground ml-1">Ou selecione um grupo genérico:</Label>
                    <Select value={insoleGroupId || "none"} onValueChange={(v) => setInsoleGroupId(v === "none" ? null : v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecionar grupo…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
        )}
      </Card>

      {/* ─── Reference preview dialog ──────────────────────────────
          Mostra só a RÉGUA da referência. As colunas de consumo saíram em
          03/08/2026 junto com a tabela do Passo 4 — copiar consumo aqui
          gravava no espelho e era apagado no próximo salvamento do
          Consumo Padrão. */}
      <Dialog open={!!referencePreview} onOpenChange={(open) => !open && setReferencePreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revisar Numerações do Solado de Referência</DialogTitle>
            <DialogDescription>
              Numerações encontradas em: {referencePreview?.name} ({referencePreview?.date})
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[400px] overflow-auto border rounded-md p-3">
            <div className="flex flex-wrap gap-1.5">
              {referencePreview?.specs.map((spec: any, i: number) => {
                const s = Number(spec.size);
                const fora = soleRange && (s < soleRange.from || s > soleRange.to);
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded px-2 py-1 text-xs font-mono border ${
                      fora
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400 line-through'
                        : 'bg-background border-border'
                    }`}
                    title={fora ? 'Fora da faixa deste solado — não será copiada' : 'Será copiada'}
                  >
                    {spec.size}
                  </span>
                );
              })}
            </div>
            {soleRange && (
              <p className="mt-3 text-xs text-muted-foreground">
                Só entram as numerações dentro da faixa deste solado
                (<strong>{soleRange.from}–{soleRange.to}</strong>). O consumo por par
                não é copiado — ele é do modelo, em <strong>Consumo Padrão</strong>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReferencePreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmPull}>
              Substituir Grade Atual
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copiar de qualquer solado (round 19) */}
      <CopyFromAnySoleDialog
        open={copyAnyOpen}
        onOpenChange={setCopyAnyOpen}
        targetSoleId={soleId}
        targetSoleName={soleName}
        hasExistingSpecs={sizes.length > 0}
        onCopied={() => {
          // Recarrega dados após cópia
          fetchAll();
          qc.invalidateQueries({ queryKey: ['soles_with_specs'] });
          qc.invalidateQueries({ queryKey: ['v_soles_audit'] });
          qc.invalidateQueries({ queryKey: ['sheets_audit'] });
        }}
      />

    </div>
  );
}
