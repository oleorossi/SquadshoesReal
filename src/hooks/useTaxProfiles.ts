import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Perfis tributários por NCM — paridade Tutor32 (fiscal #2).
 * Registry de tributação (CST/CSOSN, CFOP, alíquotas, ST) por NCM + cobertura.
 */

export interface TaxProfile {
  id: string;
  ncm: string;
  description: string;
  origem: string;
  cst_icms: string;
  aliquota_icms: number;
  cst_ipi: string;
  aliquota_ipi: number;
  cst_pis: string;
  aliquota_pis: number;
  cst_cofins: string;
  aliquota_cofins: number;
  cfop_interno: string;
  cfop_externo: string;
  mva_st: number | null;
  aliquota_icms_st: number | null;
  active: boolean;
  notes: string;
}

export type TaxProfileFormData = Omit<TaxProfile, 'id'>;

export interface NcmCoverage { ncm: string; sheets_using: number; has_profile: boolean; }

export const emptyTaxProfile = (ncm = ''): TaxProfileFormData => ({
  ncm, description: '', origem: '0',
  cst_icms: '', aliquota_icms: 0, cst_ipi: '', aliquota_ipi: 0,
  cst_pis: '', aliquota_pis: 0, cst_cofins: '', aliquota_cofins: 0,
  cfop_interno: '', cfop_externo: '', mva_st: null, aliquota_icms_st: null,
  active: true, notes: '',
});

/** Carga tributária estimada (% soma das alíquotas) — indicador rápido. */
export const estimatedTaxLoad = (p: { aliquota_icms: number; aliquota_ipi: number; aliquota_pis: number; aliquota_cofins: number }) =>
  (p.aliquota_icms || 0) + (p.aliquota_ipi || 0) + (p.aliquota_pis || 0) + (p.aliquota_cofins || 0);

export function useTaxProfiles() {
  return useQuery({
    queryKey: ['fiscal_tax_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fiscal_tax_profiles' as any).select('*').order('ncm');
      if (error) throw error;
      return (data ?? []) as unknown as TaxProfile[];
    },
  });
}

export function useNcmCoverage() {
  return useQuery({
    queryKey: ['v_ncm_coverage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_ncm_coverage' as any).select('*').order('sheets_using', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as NcmCoverage[];
    },
  });
}

function validate(d: TaxProfileFormData) {
  if (!d.ncm.trim()) throw new Error('NCM obrigatório.');
  if (!/^\d{8}$/.test(d.ncm.replace(/\D/g, ''))) throw new Error('NCM deve ter 8 dígitos.');
  for (const [k, v] of Object.entries({ ICMS: d.aliquota_icms, IPI: d.aliquota_ipi, PIS: d.aliquota_pis, COFINS: d.aliquota_cofins })) {
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`Alíquota ${k} deve estar entre 0 e 100%.`);
  }
}

function toRow(d: TaxProfileFormData) {
  return { ...d, ncm: d.ncm.replace(/\D/g, ''), mva_st: d.mva_st === null ? null : Number(d.mva_st), aliquota_icms_st: d.aliquota_icms_st === null ? null : Number(d.aliquota_icms_st) };
}

export function useAddTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TaxProfileFormData) => {
      validate(data);
      const { error } = await supabase.from('fiscal_tax_profiles' as any).insert(toRow(data) as any);
      if (error) throw error.code === '23505' ? new Error('Já existe um perfil ativo para este NCM.') : error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal_tax_profiles'] }); qc.invalidateQueries({ queryKey: ['v_ncm_coverage'] }); toast.success('Perfil tributário criado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TaxProfileFormData }) => {
      validate(data);
      const { error } = await supabase.from('fiscal_tax_profiles' as any).update(toRow(data) as any).eq('id', id);
      if (error) throw error.code === '23505' ? new Error('Já existe um perfil ativo para este NCM.') : error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal_tax_profiles'] }); qc.invalidateQueries({ queryKey: ['v_ncm_coverage'] }); toast.success('Perfil atualizado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fiscal_tax_profiles' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fiscal_tax_profiles'] }); qc.invalidateQueries({ queryKey: ['v_ncm_coverage'] }); toast.success('Perfil removido!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
