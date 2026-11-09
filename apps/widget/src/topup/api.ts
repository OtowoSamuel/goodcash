/**
 * Calls to GoodCash's own app server (not the partner API). The customer's ID details (BVN/NIN) are sent ONCE, from this
 * page (GoodCash's own site), straight to the payout partner through `createOrder`. They are never kept, never logged,
 * and never sent through the partner API or to the partner's page.
 */
export interface AppApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function makeAppApi(base: string, fetchImpl: typeof fetch = fetch): AppApi {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    } catch {
      // The browser's own text ("Failed to fetch") means nothing to a customer
      throw new Error("We couldn't reach GoodCash. Check your internet connection and try again.");
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(typeof data.error === 'string' && data.error ? data.error : 'Something went wrong. Please try again.');
    return data as T;
  }
  return {
    get: (path) => call(path),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}

export interface Institution {
  name: string;
  code: string;
  type: string;
}

export interface OnrampOrder {
  orderId: string;
  status: string;
  bank: { institution: string; accountIdentifier: string; accountName: string };
  amountToTransfer: string;
  validUntil: string;
}

export async function fetchInstitutions(api: AppApi): Promise<Institution[]> {
  const data = await api.get<{ institutions?: Institution[] }>('/institutions/NGN');
  return Array.isArray(data.institutions) ? data.institutions.filter((b) => b.type === 'bank' || !b.type) : [];
}

export async function verifyAccountName(api: AppApi, institution: string, accountIdentifier: string): Promise<string> {
  const data = await api.post<{ accountName?: string }>('/verify-account', { institution, accountIdentifier });
  if (!data.accountName) throw new Error("We couldn't find that account. Please check the bank and account number.");
  return data.accountName;
}

export interface OrderInput {
  naira: number;
  wallet: string;
  asset: 'g' | 'celo';
  fullName: string;
  birthDate: string;
  idType: 'BVN' | 'NIN';
  idNumber: string;
  expectedOut?: number;
  refundAccount: { institution: string; accountIdentifier: string; accountName: string };
}

export const createOrder = (api: AppApi, input: OrderInput) => api.post<OnrampOrder>('/onramp/orders', input);

export const relayStatus = (api: AppApi, requestId: string) => api.get<{ status: string }>(`/relay/status?requestId=${encodeURIComponent(requestId)}`).then((r) => r.status);

/** Tell GoodCash the swap finished, so the order (and the partner) learn the asset arrived. The server checks for itself. */
export const reportArrived = (api: AppApi, orderId: string, requestId: string) => api.post<unknown>(`/onramp/orders/${orderId}/arrived`, { requestId });

/** Whole-day check used by the form (the server checks again). */
export function isAdultDate(birthDate: string, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCMonth() !== mo - 1 || y < 1900) return false;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d)) age -= 1;
  return age >= 18;
}

export const formatNaira = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;
