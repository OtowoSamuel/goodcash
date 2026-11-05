# Off-Ramp Flow: GoodCash → Paycrest → NGN

Completed: November 4, 2026 (Prompt 8)

---

## Sequence Diagram

```
User Wallet          GoodCash PWA        GoodCash Worker         Paycrest API
     │                    │                    │                       │
     │   Complete swap     │                    │                       │
     │───────────────────▶│                    │                       │
     │                    │ POST /orders        │                       │
     │   Enter bank details│{amount, wallet,    │                       │
     │                    │  recipient}        │                       │
     │                    │───────────────────▶│                       │
     │                    │                    │ POST /v2/sender/orders │
     │                    │                    │───────────────────────▶│
     │                    │                    │      {orderId,          │
     │                    │                    │◀──────receiveAddress,   │
     │                    │                    │       amountToTransfer, │
     │                    │                    │       validUntil}       │
     │                    │◀───────────────────│                       │
     │  Show deposit addr  │                    │                       │
     │◀───────────────────│                    │                       │
     │                    │                    │                       │
     │  Send USDT on Celo  │                    │                       │
     │───────────────────────────────────────────────────────────────▶│
     │                    │                    │                       │
     │                    │ GET /orders/:id     │                       │
     │                    │ (poll every 10s)   │                       │
     │                    │───────────────────▶│                       │
     │                    │                    │  KV lookup / GET order │
     │                    │                    │◀───────────────────────│
     │                    │◀───────────────────│                       │
     │                    │                    │                       │
     │                    │                    │◀──── Webhook event ────│
     │                    │                    │  (payment_order.settled)│
     │                    │                    │  KV update: status      │
     │                    │                    │  Return 200            │
     │                    │                    │───────────────────────▶│
     │                    │ GET /orders/:id     │                       │
     │                    │───────────────────▶│                       │
     │                    │◀── {status:"settled", paymentReference}    │
     │  Show "✓ NGN sent"  │                    │                       │
```

---

## Worker Routes

### `POST /orders`

**Purpose:** Create a Paycrest off-ramp order. The Paycrest API key stays server-side.

**Request body (validated with Zod):**

```json
{
  "amount": "0.50",
  "swapTxHash": "0xConfirmedGoodCashSwapTransaction",
  "refundAddress": "0xUserWalletOnCelo",
  "recipient": {
    "institution": "GTBINGLA",
    "accountIdentifier": "0123456789",
    "accountName": "John Doe",
    "memo": "GoodCash"
  },
  "reference": "goodcash-abc123"
}
```

**Validation rules:**
- `amount` ≥ $0.50 (Paycrest minimum; Celo-specific limit unconfirmed — confirm with Paycrest support)
- `amount` is the swap output minus a $0.01 transaction-fee reserve; Paycrest adds `senderFee + transactionFee` on top, so `amountToSend <= usdtReceived`
- `swapTxHash` must be a successful GoodCashRouter `CashOut` from `refundAddress` to `refundAddress` with USDT output ≥ `amount`
- `refundAddress` must be a valid 0x Ethereum/Celo address
- `accountIdentifier` must be 10–20 digits
- Bank details are **never** logged at any level
- POST `/orders` and `/verify-account` are rate-limited per IP; browser origins must be in `ALLOWED_ORIGINS`

**Response (201):**

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "receiveAddress": "0xProviderCeloAddress",
  "amountToSend": "0.50",
  "currency": "USDT",
  "network": "celo",
  "memo": "optional-memo",
  "senderFee": "0",
  "transactionFee": "0.01",
  "validUntil": "2026-11-04T22:00:00Z",
  "status": "initiated"
}
```

> The client must use `amountToSend` from the response — not the input `amount`. Paycrest adds the transaction fee. Any deviation causes a refund.

---

### `GET /orders/:id`

**Purpose:** Poll order status. Reads from KV cache (updated by webhook) for fast response. Falls back to Paycrest API if no KV entry.

**Response (200):**

```json
{
  "orderId": "550e8400-...",
  "status": "settled",
  "receiveAddress": "0xProviderAddress",
  "amountToSend": "0.50",
  "validUntil": "2026-11-04T22:00:00Z",
  "paymentReference": "GTB-REF-XYZ123"
}
```

---

### `POST /webhooks/paycrest`

**Purpose:** Receive signed Paycrest status events and update KV order state.

**Signature verification:**
- `X-Paycrest-Signature` header = HMAC-SHA256(`PAYCREST_API_SECRET`, request body)
- Compared with timing-safe equality
- Returns 403 if invalid

**What is stored in KV (no PII):**

```json
{
  "status": "settled",
  "receiveAddress": "0xProvider",
  "amountToTransfer": "0.50",
  "validUntil": "...",
  "paymentReference": "GTB-REF-XYZ"
}
```

---

## Order Status Lifecycle

| Status | Meaning |
|--------|---------|
| `initiated` | Order created, awaiting USDT deposit |
| `deposited` | Deposit detected on-chain |
| `pending` | Paycrest processing |
| `fulfilling` | Bank transfer in progress |
| `validated` | Provider confirmed fiat delivery |
| `settling` | Final settlement |
| `settled` | ✓ NGN delivered to recipient |
| `expired` | Deposit window closed — create new order |
| `refunding` | Refund to `refundAddress` in progress |
| `refunded` | USDT returned to wallet |

---

## Paycrest Request Fields

| Field | Value | Note |
|-------|-------|------|
| `amount` | USDT decimal string | e.g. `"0.50"` |
| `source.type` | `"crypto"` | |
| `source.currency` | `"USDT"` | |
| `source.network` | `"celo"` | |
| `source.refundAddress` | User Celo wallet | Refund target on failure |
| `destination.type` | `"fiat"` | |
| `destination.currency` | `"NGN"` | |
| `destination.recipient.institution` | SWIFT/bank code | e.g. `"GTBINGLA"` |
| `destination.recipient.accountIdentifier` | Account number | 10-digit NUBAN |
| `destination.recipient.accountName` | Account holder name | Must match bank records |
| `reference` | Idempotency string | `goodcash-<uuid>` |
| `senderFee` | Omitted (0 in MVP) | No GoodCash fee in MVP |

---

## KYC / KYB Posture

- **GoodCash is the Sender** and must hold a KYB-verified account at Paycrest (`https://app.paycrest.io`).
- **Off-ramp customer KYC is optional** in the Paycrest v2 API — `destination.kyc` may be omitted.
- GoodCash does not store bank details. The recipient data flows directly from the client to the Worker and then to Paycrest in a single request.
- **Legal obligation:** A Nigerian lawyer must confirm whether GoodCash's off-ramp triggers money-transmission, AML, or agent obligations under NDPA 2023 or CBN regulations. Do not market "no KYC" — say the partner handles the payout.

---

## Open Items Before Smoke Test

1. **Confirm Celo minimum** with Paycrest support (docs say $0.50 on most chains; Celo not separately stated; some networks enforce 1 unit).
2. **Complete KYB** at app.paycrest.io and obtain `API-Key` and `API Secret`.
3. Set secrets in CF Worker: `wrangler secret put PAYCREST_API_KEY`, `wrangler secret put PAYCREST_API_SECRET`.
4. Create KV namespace: `wrangler kv namespace create ORDER_STORE` and replace `<KV_NAMESPACE_ID>` in `wrangler.toml`.
5. Deploy the Worker and configure its real URL in the web app: `VITE_ORDERS_API_URL=https://<deployed-worker-domain>`.
6. Set `ALLOWED_ORIGINS` in `wrangler.toml` to the real web origin(s) before deploying.
7. Run a **real smoke test** at the minimum ($0.51 USDT sent; $0.50 payout amount) with a real NGN bank account. Verify settlement and paymentReference.
8. Set up the webhook endpoint in the Paycrest dashboard pointing to `https://<deployed-worker-domain>/webhooks/paycrest`.

---

## Security Notes

- The Paycrest `API-Key` and `API-Secret` **never leave the Worker**. The client only receives orderId, receiveAddress, and amounts.
- Bank details (accountIdentifier, accountName) are validated in the Worker but **never logged** at any level.
- Webhook signatures use HMAC-SHA256 with timing-safe comparison.
- Expired orders force a new `createOrder()` call — the old `receiveAddress` is never shown again.
- Orders stored in KV contain no PII: only status, receiveAddress, amountToTransfer, validUntil, and paymentReference.
