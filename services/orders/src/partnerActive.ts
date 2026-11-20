/**
 * "Partners using the SDK" means partners with at least one REAL transaction: a live cash out that was paid, or a
 * live top-up that was delivered. Test keys never count. The first time it happens for a partner, one marker is
 * written (`partneractive:<partnerId>`); counting is then one list call. Nothing is written again for that partner,
 * and a failure here is logged and never touches the partner's order.
 */
type Store = Pick<KVNamespace, 'get' | 'put' | 'list'>;

const PREFIX = 'partneractive:';
const MAX_COUNTED = 1000;

export async function markPartnerActive(store: Store, partnerId: string): Promise<void> {
  try {
    if (!/^p_[A-Za-z0-9]+$/.test(partnerId)) return;
    if ((await store.get(`${PREFIX}${partnerId}`)) !== null) return;
    await store.put(`${PREFIX}${partnerId}`, String(Date.now()));
  } catch (e) {
    console.error('[stats] could not mark a partner active:', (e as Error)?.message);
  }
}

/** How many partners have had a real transaction. Counts only: no names. */
export async function countActivePartners(store: Pick<KVNamespace, 'list'>): Promise<number> {
  const listed = await store.list({ prefix: PREFIX, limit: MAX_COUNTED });
  return listed.keys.length;
}
