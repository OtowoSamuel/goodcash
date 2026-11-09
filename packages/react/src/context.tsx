import React, { createContext, useContext, useMemo } from 'react';
import { GoodCash, type GoodCashOptions } from '@goodcash/sdk';
import type { GoodCashTheme } from './theme';

interface Ctx {
  client: GoodCash;
  theme: GoodCashTheme;
}

const GoodCashContext = createContext<Ctx | null>(null);

export interface GoodCashProviderProps extends Omit<GoodCashOptions, 'secretKey'> {
  /** Your publishable key (gc_pk_...). Never a secret key. */
  publishableKey: string;
  theme?: GoodCashTheme;
  /** Advanced/tests: bring your own client */
  client?: GoodCash;
  children: React.ReactNode;
}

export function GoodCashProvider({ publishableKey, appId, baseUrl, rpcUrl, fetch, theme, client, children }: GoodCashProviderProps) {
  const value = useMemo<Ctx>(
    () => ({ client: client ?? new GoodCash({ publishableKey, appId, baseUrl, rpcUrl, fetch }), theme: theme ?? {} }),
    [client, publishableKey, appId, baseUrl, rpcUrl, fetch, theme]
  );
  return <GoodCashContext.Provider value={value}>{children}</GoodCashContext.Provider>;
}

export function useGoodCash(): Ctx {
  const ctx = useContext(GoodCashContext);
  if (!ctx) throw new Error('Wrap your app (or the cash out button) in <GoodCashProvider publishableKey="gc_pk_...">.');
  return ctx;
}
