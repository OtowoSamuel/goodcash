export interface OrderRequest {
  amount: bigint;
  currency: string;
}

export default {
  async fetch(_: Request): Promise<Response> {
    return Response.json({ ok: true, message: 'GoodCash order service scaffolded.' });
  }
};
