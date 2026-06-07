import { useState, useEffect, useMemo } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footprints, FloppyDisk as Save, CircleNotch as Loader2, ArrowsClockwise as RefreshCw, Stack as Layers, Shield, Plus, X, Copy, Info, MagnifyingGlass as Search, Link as Link2, Warning as AlertTriangle, CaretDown as ChevronDown, Calculator } from '@phosphor-icons/react';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
import { safeToFixed } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface SoleTechnicalDetailsProps {
  soleId: string;
  soleName?: string;
  shoeCategory?: string;
  onClose?: () => void;
}

interface SoleSpec {
  size: number;
  lining_consumption_dm2: number | null;
  insole_consumption_dm2: number | null;
  insole_lining_consumption_dm2: number | null;
  fachete_lining_consumption_dm2: number | null;
}

// Presets de numeração — agora cobrem todas as faixas comuns na fábrica.
// `categories` indica em quais shoe_category esse preset é recomendado.
// Quando o solado tem shoe_category atrelada, presets recomendados aparecem
// primeiro na ordem com badge visual.
const SIZE_PRESETS: Array<{ label: string; sizes: number[]; categories: string[] }> = [
  { label: 'Adulto 34–40',         sizes: [34, 35, 36, 37, 38, 39, 40],                            categories: ['Adulto', 'Feminino'] },
  { label: 'Adulto 33–42',         sizes: [33, 34, 35, 36, 37, 38, 39, 40, 41, 42],                categories: ['Adulto', 'Feminino', 'Unissex'] },
  { label: 'Adulto Grande 38–46',  sizes: [38, 39, 40, 41, 42, 43, 44, 45, 46],                    categories: ['Adulto', 'Masculino'] },
  { label: 'Masculino 38–44',      sizes: [38, 39, 40, 41, 42, 43, 44],                            categories: ['Masculino'] },
  { label: 'Infantil 25–34',       sizes: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34],                categories: ['Infantil'] },
  { label: 'Infantil Pequeno 22–28', sizes: [22, 23, 24, 25, 26, 27, 28],                          categories: ['Infantil'] },
  { label: 'Baby 15–24',           sizes: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24],                categories: ['Baby', 'Bebê'] },
];

function getSortedPresets(shoeCategory?: string | null): Array<{ label: string; sizes: number[]; recommended: boolean }> {
  const cat = (shoeCategory || '').trim();
  if (!cat) {
    return SIZE_PRESETS.map(p => ({ label: p.label, sizes: p.sizes, recommended: false }));
  }
  const recommended: typeof SIZE_PRESETS = [];
  const others: typeof SIZE_PRESETS = [];
  for (const p of SIZE_PRESETS) {
    if (p.categories.some(c => c.toLowerCase() === cat.toLowerCase())) recommended.push(p);
    else others.push(p);
  }
  return [
    ...recommended.map(p => ({ label: p.label, sizes: p.sizes, recommended: true })),
    ...others.map(p      => ({ label: p.label, sizes: p.sizes, recommended: false })),
  ];
}

export function SoleTechnicalDetails({ soleId, soleName, onClose }: SoleTechnicalDetailsProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  // Audit visual S8: troca window.confirm() nativo por Dialog estilizado.
  // Antes o prompt do browser era ilegível em dark mode e quebrava o design system.
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [missingWarnings, setMissingWarnings] = useState<string[]>([]);
  const [specs, setSpecs] = useState<Record<number, SoleSpec>>({});
  // Buffer de texto cru por célula EM EDIÇÃO. Sem isto o input controlado
  // re-renderizava o NÚMERO armazenado (`toString()`) a cada tecla: digitar
  // "4," reparsa pra 4 → exibe "4" e a vírgula some na hora, impossibilitando
  // casas decimais. Mantendo o texto cru enquanto a célula está focada, o user
  // digita "4,68" livremente; o número é parseado em paralelo pro `specs` e o
  // buffer é descartado no blur (volta a exibir o canônico). Preserva null pra
  // vazio (a SQL cai na média escalar quando o tamanho não tem valor).
  // (Bug 2026-06-07: não aceitava numeração após a vírgula.)
  const [rawCellEdits, setRawCellEdits] = useState<Record<string, string>>({});
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
  const [soleClassification, setSoleClassification] = useState<'tradicional' | 'palmilha_pronta' | 'conjugado' | null>(null);
  const [isFachetado, setIsFachetado] = useState<boolean>(false);
  // Solado de palmilha pronta vem forrado do fornecedor — palmilha conta como
  // UN, não dm². A grade não cobra "placa" nem "forração da palmilha", só
  // a forração do CABEDAL (e fachete se aplicável).
  const isPalmilhaPronta = soleClassification === 'palmilha_pronta';
  const [shoeCategory, setShoeCategory] = useState<string | null>(null);
  // Passo 3 (Materiais padrão) é opcional — escondemos por default pra não
  // competir visualmente com o Passo 4 (onde o consumo de verdade é definido).
  // User pode expandir se quiser configurar material default.
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

  /**
   * Linhas EXIBIDAS na tabela de consumo (Passo 4). Agrupa numerações
   * conjugadas em UMA linha (ex: 33/34 = 1 linha que edita os dois tamanhos
   * simultaneamente). Tamanhos não conjugados ficam em linhas individuais.
   *
   * Ordenado pelo MENOR tamanho de cada grupo, pra manter ordem natural
   * (33/34 antes de 35, 35 antes de 39/40, etc.).
   */
  type DisplayRow = { key: string; sizes: number[]; isConjugated: boolean };
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (sizes.length === 0) return [];

    const seen = new Set<number>();
    const rows: DisplayRow[] = [];

    for (const s of sizes) {
      if (seen.has(s)) continue;
      const conjKey = sizeToConjKey.get(s);
      if (conjKey) {
        const conj = conjugations.find(c => c.size_key === conjKey);
        if (conj) {
          // Agrupa todos os tamanhos da conjugação que estão na grade atual
          const sizesInRow = conj.sizes.filter(x => sizes.includes(x)).sort((a, b) => a - b);
          for (const x of sizesInRow) seen.add(x);
          rows.push({ key: conjKey, sizes: sizesInRow, isConjugated: sizesInRow.length > 1 });
          continue;
        }
      }
      seen.add(s);
      rows.push({ key: String(s), sizes: [s], isConjugated: false });
    }

    return rows.sort((a, b) => a.sizes[0] - b.sizes[0]);
  }, [sizes, sizeToConjKey, conjugations]);

  /**
   * Lê o valor "representativo" de uma linha (primeiro size com valor
   * preenchido, ou null se nenhum tem). Numa linha conjugada os valores
   * dos N sizes deveriam ser iguais — se divergem, mostra o do primeiro.
   */
  const getRowValue = (row: DisplayRow, field: keyof SoleSpec): number | null => {
    for (const s of row.sizes) {
      const v = specs[s]?.[field];
      if (v != null) return v as number;
    }
    return null;
  };

  /**
   * Setter de valor pra uma linha — escreve em TODOS os sizes da linha
   * (mantendo conjugação sincronizada).
   */
  const cellEditKey = (row: DisplayRow, field: keyof SoleSpec) => `${row.key}::${String(field)}`;

  /** Valor exibido no input: o texto cru se a célula está em edição; senão o
   *  número canônico armazenado (string vazia quando null). */
  const getRowInputValue = (row: DisplayRow, field: keyof SoleSpec): string => {
    const k = cellEditKey(row, field);
    if (k in rawCellEdits) return rawCellEdits[k];
    const v = getRowValue(row, field);
    return v != null ? String(v) : "";
  };

  const handleRowInputChange = (row: DisplayRow, field: keyof SoleSpec, value: string) => {
    // Guarda o texto cru enquanto edita (deixa o user digitar "4," → "4,6" →
    // "4,68" sem a vírgula sumir no round-trip número→string).
    setRawCellEdits(prev => ({ ...prev, [cellEditKey(row, field)]: value }));
    const parsed = parseFloat(value.replace(",", "."));
    const numValue = value.trim() === "" ? null : (Number.isFinite(parsed) ? parsed : null);
    setSpecs(prev => {
      const next = { ...prev };
      for (const s of row.sizes) {
        next[s] = {
          ...(next[s] || { size: s, lining_consumption_dm2: null, insole_consumption_dm2: null, insole_lining_consumption_dm2: null, fachete_lining_consumption_dm2: null }),
          [field]: numValue,
        };
      }
      return next;
    });
  };

  /** Ao sair da célula, descarta o buffer cru → volta a exibir o canônico. */
  const handleRowInputBlur = (row: DisplayRow, field: keyof SoleSpec) => {
    const k = cellEditKey(row, field);
    setRawCellEdits(prev => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  /**
   * Remove uma linha inteira — se conjugada, remove todos os sizes.
   */
  const removeRow = (row: DisplayRow) => {
    setSizes(prev => prev.filter(s => !row.sizes.includes(s)));
    setSpecs(prev => {
      const next = { ...prev };
      for (const s of row.sizes) delete next[s];
      return next;
    });
  };

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
              setSizes(prev => {
                // Só auto-popula se ainda não há sizes carregados de specs.
                // Não sobrescreve dados existentes — só preenche o vazio.
                if (prev.length > 0) return prev;
                const all: number[] = [];
                for (let s = from; s <= to; s++) all.push(s);
                return all;
              });
            }
          }
          // Inferência heurística de categoria pelo nome do solado (legacy,
          // mantido pra display info, não pra preset buttons que foram removidos)
          const name = (d?.name || '').toLowerCase();
          if (name.includes('baby') || name.includes('beb')) setShoeCategory('Baby');
          else if (name.includes('infantil') || name.includes('kids')) setShoeCategory('Infantil');
          else if (name.includes('masc')) setShoeCategory('Masculino');
          else if (name.includes('fem')) setShoeCategory('Feminino');
          else setShoeCategory('Adulto');
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
    setSizes(loadedSizes);

    const specsMap: Record<number, SoleSpec> = {};
    (specsData || []).forEach((item: any) => {
      specsMap[item.size] = {
        size: item.size,
        lining_consumption_dm2: item.lining_consumption_dm2,
        insole_consumption_dm2: item.insole_consumption_dm2,
        insole_lining_consumption_dm2: item.insole_lining_consumption_dm2 ?? null,
        fachete_lining_consumption_dm2: item.fachete_lining_consumption_dm2 ?? null,
      };
    });
    setSpecs(specsMap);

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

    const { specs: filteredSpecs, soleId: refSoleId, name: refName, date: refDate } = referencePreview;

    const loadedSizes = filteredSpecs.map((r: any) => Number(r.size)).sort((a, b) => a - b);
    setSizes(loadedSizes);

    const specsMap: Record<number, SoleSpec> = {};
    filteredSpecs.forEach((item: any) => {
      specsMap[item.size] = {
        size: item.size,
        lining_consumption_dm2: item.lining_consumption_dm2,
        insole_consumption_dm2: item.insole_consumption_dm2,
        insole_lining_consumption_dm2: item.insole_lining_consumption_dm2 ?? null,
        fachete_lining_consumption_dm2: item.fachete_lining_consumption_dm2 ?? null,
      };
    });
    setSpecs(specsMap);

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
    toast.success(`Consumos carregados da referência: ${refName}`);
  };

  const applyPreset = (presetSizes: number[]) => {
    setSizes(presetSizes);
    setSpecs((prev) => {
      const next: Record<number, SoleSpec> = {};
      presetSizes.forEach((s) => {
        next[s] = prev[s] || { size: s, lining_consumption_dm2: null, insole_consumption_dm2: null, insole_lining_consumption_dm2: null, fachete_lining_consumption_dm2: null };
      });
      return next;
    });
  };

  const addSize = () => {
    const n = parseInt(newSize.trim(), 10);
    if (!n || n < 10 || n > 60) { toast.error("Numeração inválida (10–60)"); return; }
    if (sizes.includes(n)) { toast.error("Numeração já adicionada"); return; }
    const next = [...sizes, n].sort((a, b) => a - b);
    setSizes(next);
    setSpecs((prev) => ({
      ...prev,
      [n]: { size: n, lining_consumption_dm2: null, insole_consumption_dm2: null, insole_lining_consumption_dm2: null, fachete_lining_consumption_dm2: null },
    }));
    setNewSize("");
  };

  const removeSize = (size: number) => {
    setSizes((prev) => prev.filter((s) => s !== size));
    setSpecs((prev) => {
      const next = { ...prev };
      delete next[size];
      return next;
    });
  };

  // handleInputChange + fillConjugatedFromSize foram substituídos pelo
  // novo modelo de displayRows (linhas conjugadas atômicas) — handleRowInputChange
  // já escreve em todos os sizes da linha em uma chamada.

  const fillRemaining = (field: "lining_consumption_dm2" | "insole_consumption_dm2" | "insole_lining_consumption_dm2" | "fachete_lining_consumption_dm2") => {
    const firstValue = Object.values(specs).find((s) => s[field] !== null)?.[field];
    if (firstValue === undefined || firstValue === null) return;
    const next = { ...specs };
    sizes.forEach((size) => {
      if (!next[size] || next[size][field] === null) {
        next[size] = { ...(next[size] || { size, lining_consumption_dm2: null, insole_consumption_dm2: null, insole_lining_consumption_dm2: null, fachete_lining_consumption_dm2: null }), [field]: firstValue };
      }
    });
    setSpecs(next);
  };

  /**
   * Validação pré-salvar: lista campos vazios (forro, palmilha, fachete se aplicável).
   * Mostra dialog/confirmação se houver. Evita o fallback escalar silencioso na RPC.
   */
  const validateSpecs = (): { ok: boolean; warnings: string[] } => {
    const warnings: string[] = [];
    const missingLining: number[] = [];
    const missingInsole: number[] = [];
    const missingFachete: number[] = [];

    for (const s of sizes) {
      const spec = specs[s];
      if (!spec || spec.lining_consumption_dm2 === null || spec.lining_consumption_dm2 <= 0) {
        missingLining.push(s);
      }
      if (!isPalmilhaPronta && (!spec || spec.insole_consumption_dm2 === null || spec.insole_consumption_dm2 <= 0)) {
        missingInsole.push(s);
      }
      if (isFachetado && (!spec || spec.fachete_lining_consumption_dm2 === null || spec.fachete_lining_consumption_dm2 <= 0)) {
        missingFachete.push(s);
      }
    }

    if (missingLining.length > 0) warnings.push(`Forração: ${missingLining.join(', ')}`);
    if (missingInsole.length > 0) warnings.push(`Palmilha: ${missingInsole.join(', ')}`);
    if (missingFachete.length > 0) warnings.push(`Fachete: ${missingFachete.join(', ')}`);

    return { ok: warnings.length === 0, warnings };
  };

  const handleSave = async (skipMissingCheck = false) => {
    if (sizes.length === 0) { toast.error("Defina ao menos uma numeração"); return; }

    if (!skipMissingCheck) {
      const { ok, warnings } = validateSpecs();
      if (!ok) {
        // Audit visual S8: abre dialog estilizado em vez de window.confirm.
        setMissingWarnings(warnings);
        setMissingDialogOpen(true);
        return;
      }
    }

    setSaving(true);
    try {
      const dataToUpsert = sizes.map((size) => ({
        sole_id: soleId,
        size,
        lining_consumption_dm2: specs[size]?.lining_consumption_dm2 ?? null,
        insole_consumption_dm2: specs[size]?.insole_consumption_dm2 ?? null,
        insole_lining_consumption_dm2: specs[size]?.insole_lining_consumption_dm2 ?? null,
        fachete_lining_consumption_dm2: specs[size]?.fachete_lining_consumption_dm2 ?? null,
        reference_sole_id: referenceInfo?.id || null,
        reference_date: referenceInfo ? new Date().toISOString() : null
      }));
      const { error: specsError } = await supabase
        .from("sole_technical_specs")
        .upsert(dataToUpsert, { onConflict: "sole_id,size" });
      if (specsError) throw specsError;

      // ── Espelha consumo pra TODAS as cores do mesmo solado ──
      // Conforme decisão do usuário: "Pasta de solados, para consumo e
      // definições técnicas é indiferente a cor do solado, isso só faz
      // diferença pra combinação de cabedal".
      // Buscamos todos products com o mesmo group_id (variantes de cor do
      // mesmo solado) e replicamos os specs pra cada um. Cor é só pra
      // estoque/expedição — consumo técnico é por referência.
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
            lining_consumption_dm2: specs[size]?.lining_consumption_dm2 ?? null,
            insole_consumption_dm2: specs[size]?.insole_consumption_dm2 ?? null,
            insole_lining_consumption_dm2: specs[size]?.insole_lining_consumption_dm2 ?? null,
            fachete_lining_consumption_dm2: specs[size]?.fachete_lining_consumption_dm2 ?? null,
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
      toast.success("Grade e consumos salvos!");
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
            <h2 className="text-lg font-semibold">Grade de Numerações e Consumos</h2>
            <p className="text-sm text-muted-foreground">
              {soleName || "Solado"} — siga os passos abaixo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => soleName && tryLoadReferenceSpecs(soleName)}
            disabled={saving || isReferenceLoading || !soleName}
            className="gap-2 shrink-0 border-blue-200 hover:border-blue-400 text-blue-700 bg-blue-50/50"
            title="Tenta achar specs em outro solado com nome similar (mesma família)"
          >
            {isReferenceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Puxar de Família
          </Button>
          <Button
            variant="outline"
            onClick={() => setCopyAnyOpen(true)}
            disabled={saving}
            className="gap-2 shrink-0 border-purple-200 hover:border-purple-400 text-purple-700 bg-purple-50/50"
            title="Escolhe qualquer solado já cadastrado como base — você ajusta depois"
          >
            <Copy className="h-4 w-4" />
            Copiar de Qualquer Solado
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
            Aqui você só configura o consumo individual de cada uma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
          O consumo de verdade é definido no Passo 4 — esse passo é só sugestão
          de qual produto usar quando o PV não escolher.
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
              {' '}<strong>Não afeta consumo</strong> — o cálculo de dm² vem do Passo 4 abaixo.
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
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          placeholder="Buscar material..."
                          value={liningSearch}
                          onChange={(e) => setLiningSearch(e.target.value)}
                          className="h-7 text-xs pl-7"
                        />
                      </div>
                    </div>
                    <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                    {products
                      .filter(p => !liningSearch || p.name.toLowerCase().includes(liningSearch.toLowerCase()) || p.category?.toLowerCase().includes(liningSearch.toLowerCase()))
                      .slice(0, 100)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex flex-col">
                            <span className="text-xs">{p.name}</span>
                            <span className="text-xs text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                          </div>
                        </SelectItem>
                      ))}
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
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          placeholder="Buscar material..."
                          value={insoleSearch}
                          onChange={(e) => setInsoleSearch(e.target.value)}
                          className="h-7 text-xs pl-7"
                        />
                      </div>
                    </div>
                    <SelectItem value="none">Nenhum (usar grupo)</SelectItem>
                    {products
                      .filter(p => !insoleSearch || p.name.toLowerCase().includes(insoleSearch.toLowerCase()) || p.category?.toLowerCase().includes(insoleSearch.toLowerCase()))
                      .slice(0, 100)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex flex-col">
                            <span className="text-xs">{p.name}</span>
                            <span className="text-xs text-muted-foreground">{p.category} {p.color ? `· ${p.color}` : ""}</span>
                          </div>
                        </SelectItem>
                      ))}
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

      {/* ─── Passo 4: Tabela de consumos por numeração ─────────────
          Card destacado com border primary + bg gradient — é AQUI que
          o consumo de verdade vai. Banner explicativo no topo deixa
          isso visualmente óbvio (resolve confusão do user com Passo 3).
      */}
      {sizes.length > 0 && (
        <Card className="border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 shadow-sm">
          <div className="px-4 pt-4 pb-2 flex items-start gap-3">
            <div className="bg-primary/15 p-1.5 rounded-md shrink-0">
              <Calculator className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-foreground">Consumo por numeração</span>
                <Badge className="bg-primary/15 text-primary border-primary/30 text-xs h-5">
                  ★ Fonte do cálculo
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define quantos <strong>dm²/par</strong> são consumidos de
                {isPalmilhaPronta ? ' Forração do cabedal' : ' Forração / Palmilha'} por tamanho.
                <strong className="text-foreground"> Vale pra QUALQUER material</strong> que o PV escolher
                (couro, lona, sintético, etc.) — independe da seleção do Passo 3.
                {isPalmilhaPronta && (
                  <span className="block mt-1 text-[11px] text-violet-700 dark:text-violet-300">
                    <strong>Palmilha pronta</strong>: o solado vem forrado de fábrica. Não há cobrança
                    de placa nem de forração da palmilha — só do cabedal.
                  </span>
                )}
              </p>
            </div>
          </div>
          <CardHeader className="pb-2 pt-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                {/* Título consolidado no banner acima — aqui só sublabel com dica */}
                <CardDescription className="text-xs">
                  Preencha {isPalmilhaPronta ? 'forração' : 'forração, palmilha'} {isFachetado && '+ fachete'} por tamanho. Conjugadas (🔗) aparecem como UMA
                  linha. Tamanhos sem valor caem na <span className="text-amber-700 dark:text-amber-400 font-semibold">média escalar</span>.
                </CardDescription>
              </div>
              {/* Modo simplificado: 1 input que replica pra TODOS — útil quando o consumo é
                  igual em todas as numerações do solado. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // Pega o primeiro valor não-vazio de cada coluna e replica
                    const replicate = (field: keyof SoleSpec) => {
                      const first = sizes.find(s => specs[s]?.[field] != null)?.toString();
                      if (!first) return;
                      const v = specs[Number(first)]?.[field];
                      setSpecs(prev => {
                        const next = { ...prev };
                        for (const s of sizes) {
                          next[s] = { ...next[s], size: s, [field]: v } as SoleSpec;
                        }
                        return next;
                      });
                    };
                    replicate('lining_consumption_dm2');
                    if (!isPalmilhaPronta) {
                      replicate('insole_consumption_dm2');
                      replicate('insole_lining_consumption_dm2');
                    }
                    if (isFachetado) replicate('fachete_lining_consumption_dm2');
                    toast.success('Valor do primeiro tamanho replicado para todas as numerações.');
                  }}
                  className="text-xs px-3 py-1.5 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5"
                  title="Pega o primeiro valor preenchido de cada coluna e replica em todas as numerações"
                >
                  <Copy className="h-3 w-3" /> Replicar 1º valor em todos
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isFachetado && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-semibold">Solado Fachetado</span>
                <span className="text-amber-600/70">— preencha o consumo de fachete por numeração</span>
              </div>
            )}
            {/* Audit visual S9: wrapper overflow-x-auto pra tabela não espremer
                em mobile. Antes overflow-hidden cortava colunas em < 640px. */}
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-20 text-center font-bold">TAM</TableHead>
                    <TableHead>
                      <div className="flex items-center justify-between">
                        <span>Forração (dm²/par)</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor para tamanhos vazios" onClick={() => fillRemaining("lining_consumption_dm2")}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableHead>
                    {!isPalmilhaPronta && (
                      <TableHead>
                        <div className="flex items-center justify-between">
                          <span>Palmilha · Placa (dm²/par)</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor para tamanhos vazios" onClick={() => fillRemaining("insole_consumption_dm2")}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableHead>
                    )}
                    {!isPalmilhaPronta && (
                      <TableHead>
                        <div className="flex items-center justify-between">
                          <span title="Área da napa que forra a palmilha (usa a napa da Forração)">Palmilha · Forração (dm²/par)</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor para tamanhos vazios" onClick={() => fillRemaining("insole_lining_consumption_dm2")}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableHead>
                    )}
                    {isFachetado && (
                      <TableHead className="bg-amber-500/5">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-700 dark:text-amber-400">Fachete (dm²/par)</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Replicar primeiro valor" onClick={() => fillRemaining("fachete_lining_consumption_dm2")}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((row) => (
                    <TableRow
                      key={row.key}
                      /* Audit visual S7: bg-blue-500/5 + text-blue-700 caía abaixo
                         do contraste WCAG em dark mode. Aumentado pra dark:bg-blue-500/15
                         e dark:text-blue-300 — paleta de alerta visual mantida. */
                      className={
                        row.isConjugated
                          ? 'bg-blue-500/5 dark:bg-blue-500/15 hover:bg-blue-500/10 dark:hover:bg-blue-500/25 border-l-2 border-l-blue-500/40 focus-within:bg-blue-500/15 dark:focus-within:bg-blue-500/30 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500/50 transition-colors'
                          : 'hover:bg-muted/30'
                      }
                    >
                      <TableCell className={`text-center p-2 ${row.isConjugated ? 'bg-blue-500/10 dark:bg-blue-500/25' : 'bg-muted/20'}`}>
                        <div className="flex items-center justify-center gap-1">
                          {row.isConjugated ? (
                            <Badge
                              className="text-xs gap-1 px-1.5 py-0.5 font-mono font-bold bg-blue-500/15 text-blue-700 dark:text-blue-300 dark:bg-blue-500/25 border-blue-500/40"
                              title={`Conjugação: ${row.sizes.join(' + ')} — alterar 1 valor sincroniza ${row.sizes.length} tamanhos`}
                            >
                              <Link2 className="h-3 w-3" />
                              {row.key}
                            </Badge>
                          ) : (
                            <span className="font-bold">{row.key}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="p-1.5">
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="h-8 text-right font-mono"
                          value={getRowInputValue(row, "lining_consumption_dm2")}
                          onChange={(e) => handleRowInputChange(row, "lining_consumption_dm2", e.target.value)}
                          onBlur={() => handleRowInputBlur(row, "lining_consumption_dm2")}
                          placeholder="0.00"
                        />
                      </TableCell>
                      {!isPalmilhaPronta && (
                        <TableCell className="p-1.5">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="h-8 text-right font-mono"
                            value={getRowInputValue(row, "insole_consumption_dm2")}
                            onChange={(e) => handleRowInputChange(row, "insole_consumption_dm2", e.target.value)}
                            onBlur={() => handleRowInputBlur(row, "insole_consumption_dm2")}
                            placeholder="0.00"
                          />
                        </TableCell>
                      )}
                      {!isPalmilhaPronta && (
                        <TableCell className="p-1.5">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="h-8 text-right font-mono"
                            value={getRowInputValue(row, "insole_lining_consumption_dm2")}
                            onChange={(e) => handleRowInputChange(row, "insole_lining_consumption_dm2", e.target.value)}
                            onBlur={() => handleRowInputBlur(row, "insole_lining_consumption_dm2")}
                            placeholder="0.00"
                          />
                        </TableCell>
                      )}
                      {isFachetado && (
                        <TableCell className="bg-amber-500/5 p-1.5">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="h-8 text-right font-mono border-amber-500/30 focus-visible:ring-amber-500/30"
                            value={getRowInputValue(row, "fachete_lining_consumption_dm2")}
                            onChange={(e) => handleRowInputChange(row, "fachete_lining_consumption_dm2", e.target.value)}
                            onBlur={() => handleRowInputBlur(row, "fachete_lining_consumption_dm2")}
                            placeholder="0.00"
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Reference preview dialog ────────────────────────────── */}
      <Dialog open={!!referencePreview} onOpenChange={(open) => !open && setReferencePreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Revisar Consumos do Solado de Referência</DialogTitle>
            <DialogDescription>
              Valores encontrados em: {referencePreview?.name} ({referencePreview?.date})
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[400px] overflow-y-auto border rounded-md p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-center py-2">TAM</th>
                  <th className="text-right py-2 px-4">Forração (dm²)</th>
                  {!isPalmilhaPronta && <th className="text-right py-2 px-4">Palmilha · Placa (dm²)</th>}
                  {!isPalmilhaPronta && <th className="text-right py-2 px-4">Palmilha · Forração (dm²)</th>}
                  {isFachetado && <th className="text-right py-2 px-4">Fachete (dm²)</th>}
                </tr>
              </thead>
              <tbody>
                {referencePreview?.specs.map((spec: any, i: number) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="text-center py-2 font-bold">{spec.size}</td>
                    <td className="text-right py-2 px-4 font-mono">
                      {spec.lining_consumption_dm2 !== null ? safeToFixed(spec.lining_consumption_dm2, 2) : "-"}
                    </td>
                    {!isPalmilhaPronta && (
                      <td className="text-right py-2 px-4 font-mono">
                        {spec.insole_consumption_dm2 !== null ? safeToFixed(spec.insole_consumption_dm2, 2) : "-"}
                      </td>
                    )}
                    {!isPalmilhaPronta && (
                      <td className="text-right py-2 px-4 font-mono">
                        {spec.insole_lining_consumption_dm2 != null ? safeToFixed(spec.insole_lining_consumption_dm2, 2) : "-"}
                      </td>
                    )}
                    {isFachetado && (
                      <td className="text-right py-2 px-4 font-mono">
                        {spec.fachete_lining_consumption_dm2 != null ? safeToFixed(spec.fachete_lining_consumption_dm2, 2) : "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReferencePreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmPull}>
              Substituir Grade e Consumos Atuais
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
        hasExistingSpecs={Object.keys(specs).length > 0}
        onCopied={() => {
          // Recarrega dados após cópia
          fetchAll();
          qc.invalidateQueries({ queryKey: ['soles_with_specs'] });
          qc.invalidateQueries({ queryKey: ['v_soles_audit'] });
          qc.invalidateQueries({ queryKey: ['sheets_audit'] });
        }}
      />

      {/* Audit visual S8: dialog estilizado pra confirmação de save com tamanhos
          incompletos. Substitui window.confirm() nativo. */}
      <Dialog open={missingDialogOpen} onOpenChange={setMissingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Tamanhos sem consumo preenchido
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p className="text-sm text-foreground">
                Os tamanhos abaixo vão usar a média escalar da ficha técnica como fallback,
                o que pode <strong>subdimensionar a ordem de produção</strong>:
              </p>
              <ul className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1">
                {missingWarnings.map((w, i) => (
                  <li key={i} className="font-mono">• {w}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Recomendado preencher os valores corretos antes de salvar.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setMissingDialogOpen(false)}>
              Voltar e revisar
            </Button>
            <Button
              variant="default"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                setMissingDialogOpen(false);
                handleSave(true);
              }}
            >
              Salvar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
