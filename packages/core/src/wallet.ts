/** Rules learned from real customers' wallets. */

/**
 * True only when the error proves the wallet never sent anything: the customer said no, or the network refused it
 * before signing (gas estimate). Anything else (a phone wallet timing out while the customer was still approving)
 * may still have gone through, so it must never be reported as "nothing was taken".
 */
export function provesNothingWasSent(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const x = e as { name?: string; code?: number; message?: string; shortMessage?: string; cause?: unknown };
    const text = `${x.name ?? ''} ${x.shortMessage ?? ''} ${x.message ?? ''}`;
    if (x.code === 4001 || /UserRejected|user rejected|user denied|rejected the request|denied transaction/i.test(text)) return true;
    if (/EstimateGasExecutionError|ExecutionRevertedError|InsufficientFundsError|execution reverted|insufficient funds|gas required exceeds/i.test(text)) return true;
    e = x.cause;
  }
  return false;
}

/** True when the customer cancelled in their wallet. */
export function isUserRejection(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const x = e as { name?: string; code?: number; message?: string; shortMessage?: string; cause?: unknown };
    const text = `${x.name ?? ''} ${x.shortMessage ?? ''} ${x.message ?? ''}`;
    if (x.code === 4001 || /UserRejected|user rejected|user denied|rejected the request|denied transaction/i.test(text)) return true;
    e = x.cause;
  }
  return false;
}
