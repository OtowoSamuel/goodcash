import { useCallback, useEffect, useRef, useState } from 'react';
import { GoodCashError, type Bank, type CashOut, type CashOutArgs, type CashOutStep, type Quote } from '@goodcash/sdk';
import { useGoodCash } from './context';

const asError = (e: unknown) => (e instanceof GoodCashError ? e : new GoodCashError('unavailable', { detail: String((e as Error)?.message ?? e) }));

/** A live quote for an amount: waits until typing pauses, then refreshes every 25 seconds. */
export function useQuote(amountG: string | number | null | undefined, opts: { debounceMs?: number; refreshMs?: number } = {}) {
  const { client } = useGoodCash();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<GoodCashError | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = amountG === null || amountG === undefined ? '' : String(amountG).trim();
  useEffect(() => {
    if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
      setQuote(null);
      setError(null);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      setLoading(true);
      try {
        const q = await client.quote({ amountG: amount });
        if (live) {
          setQuote(q);
          setError(null);
        }
      } catch (e) {
        if (live) setError(asError(e));
      } finally {
        if (live) setLoading(false);
      }
      if (live) timer = setTimeout(run, opts.refreshMs ?? 25_000);
    };
    timer = setTimeout(run, opts.debounceMs ?? 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, amount, opts.debounceMs, opts.refreshMs]);
  return { quote, error, loading };
}

export function useBanks() {
  const { client } = useGoodCash();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [error, setError] = useState<GoodCashError | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    client
      .banks()
      .then((b) => live && setBanks(b))
      .catch((e) => live && setError(asError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client]);
  return { banks, error, loading };
}

/** Looks up the account holder's name as soon as a full account number is typed. */
export function useVerifyAccount(bankCode: string, accountNumber: string) {
  const { client } = useGoodCash();
  const [accountName, setName] = useState<string | null>(null);
  const [error, setError] = useState<GoodCashError | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setName(null);
    setError(null);
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return;
    let live = true;
    setLoading(true);
    client
      .verifyAccount({ bankCode, accountNumber })
      .then((r) => live && setName(r.accountName))
      .catch((e) => live && setError(asError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, bankCode, accountNumber]);
  return { accountName, error, loading };
}

/** Runs the whole cash out (create, check, sign, report). */
export function useCashOut() {
  const { client } = useGoodCash();
  const [step, setStep] = useState<CashOutStep | null>(null);
  const [cashOut, setCashOut] = useState<CashOut | null>(null);
  const [error, setError] = useState<GoodCashError | null>(null);
  const running = useRef(false);
  const start = useCallback(
    async (args: Omit<CashOutArgs, 'onStep'>, onStep?: CashOutArgs['onStep']) => {
      if (running.current) return null;
      running.current = true;
      setError(null);
      try {
        const out = await client.cashOut({
          ...args,
          onStep: (s, c) => {
            setStep(s);
            if (c) setCashOut(c);
            onStep?.(s, c);
          },
        });
        setCashOut(out.cashOut);
        return out;
      } catch (e) {
        setError(asError(e));
        setStep(null);
        return null;
      } finally {
        running.current = false;
      }
    },
    [client]
  );
  const reset = useCallback(() => {
    setStep(null);
    setCashOut(null);
    setError(null);
  }, []);
  return { start, step, cashOut, error, reset };
}

/** Follows a cash out until it is paid (or failed, refunded, expired). */
export function useCashOutStatus(id: string | null | undefined) {
  const { client } = useGoodCash();
  const [cashOut, setCashOut] = useState<CashOut | null>(null);
  const [error, setError] = useState<GoodCashError | null>(null);
  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    client
      .watchCashOut(id, setCashOut, { signal: ac.signal })
      .catch((e) => !ac.signal.aborted && setError(asError(e)));
    return () => ac.abort();
  }, [client, id]);
  return { cashOut, error };
}
