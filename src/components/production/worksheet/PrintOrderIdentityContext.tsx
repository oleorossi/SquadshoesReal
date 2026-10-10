import React, { createContext, useContext } from 'react';
import type { OrderIdentityLookup } from './pageIdentity';

/**
 * Lookup op_number → meta (PV, pedido cliente, razão) pro maço de impressão.
 * Preenchido em PrintWorkSheetsPage a partir de printOrders + saleOrders.
 */
const PrintOrderIdentityContext = createContext<Map<string, OrderIdentityLookup>>(new Map());

export function PrintOrderIdentityProvider({
  value,
  children,
}: {
  value: Map<string, OrderIdentityLookup>;
  children: React.ReactNode;
}) {
  return (
    <PrintOrderIdentityContext.Provider value={value}>
      {children}
    </PrintOrderIdentityContext.Provider>
  );
}

export function usePrintOrderIdentity(): Map<string, OrderIdentityLookup> {
  return useContext(PrintOrderIdentityContext);
}
