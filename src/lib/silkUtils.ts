import { supabase } from '@/integrations/supabase/client';

 export interface SilkInfo {
   silk_name: string;
   silk_url: string | null;
 }
 
 export async function getEffectiveSilk(params: { 
   soleType?: string; 
   soleProductId?: string; 
   clientId?: string; 
   economicGroupId?: string; 
 }): Promise<SilkInfo> {
   const { soleType, soleProductId, clientId, economicGroupId } = params;
 
   // Helper to find silk
   const findSilk = async (filters: any) => {
     let query = supabase.from('sole_silk_registrations').select('silk_name, silk_url');
     
     if (soleProductId) {
       query = query.eq('sole_product_id', soleProductId);
     } else if (soleType) {
       query = query.eq('sole_type', soleType);
     } else {
       return null;
     }
 
     if (filters.client_id) query = query.eq('client_id', filters.client_id);
     else query = query.is('client_id', null);
 
     if (filters.economic_group_id) query = query.eq('economic_group_id', filters.economic_group_id);
     else query = query.is('economic_group_id', null);
 
     const { data } = await query.maybeSingle();
     return data;
   };
 
   // 1. Try Client-specific
   if (clientId) {
     const silk = await findSilk({ client_id: clientId });
     if (silk) return silk;
   }
 
   // 2. Try Group-specific
   if (economicGroupId) {
     const silk = await findSilk({ economic_group_id: economicGroupId });
     if (silk) return silk;
   }
 
   // 3. Try Default
   const silk = await findSilk({});
   if (silk) return silk;
 
   return { silk_name: 'Sem Silk', silk_url: null };
 }
