export interface PackagingOption {
  method: 'amarrado' | 'master' | 'colmeia';
  packagingId: string;
  containersNeeded: number;
  leftoverPairs: number;
}

export function calculatePackaging(
  totalPairs: number, 
  modelPackagingType: string,
  customerAcceptsBundled: boolean = true
): PackagingOption {
   // 1. Se for Colmeia (Geralmente para sapatilhas ou rasteiras leves) - 12 pares por caixa
   if (modelPackagingType === 'colmeia') {
     const capacity = 12; 
     const needed = Math.ceil(totalPairs / capacity);
     return {
       method: 'colmeia',
       packagingId: 'colmeia-id',
       containersNeeded: needed,
       leftoverPairs: totalPairs % capacity
     };
   }
 
   // 2. Modo Master (Padrão 12 pares)
   // Se o cliente NÃO aceita amarrado, ou se a quantidade for maior que 6 pares
   if (!customerAcceptsBundled || totalPairs > 6) {
     const masterCapacity = 12; 
     const needed = Math.ceil(totalPairs / masterCapacity);
     return {
       method: 'master',
       packagingId: 'master-id',
       containersNeeded: needed,
       leftoverPairs: totalPairs % masterCapacity
     };
   }
 
   // 3. Modo Amarrado (Até 6 pares e cliente aceita)
   // No amarrado, geralmente usa-se fitilho para unir as caixas individuais
   return {
     method: 'amarrado',
     packagingId: 'individual-id',
     containersNeeded: 1, // 1 volume amarrado
     leftoverPairs: totalPairs
   };
}
