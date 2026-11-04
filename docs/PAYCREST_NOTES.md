# Paycrest notes

Spike date: November 4, 2026
Sources:

- `https://docs.paycrest.io/implementation-guides/sender-api-integration`
- `https://docs.paycrest.io/quickstart`
- `https://docs.paycrest.io/resources/supported-stablecoins`
- `https://docs.paycrest.io/resources/supported-currencies`
- `https://docs.paycrest.io/concepts/participants`

No order was placed during this spike. Paycrest is mainnet-only and an order spends real funds; the smoke test is a separate, deliberate step after KYB and legal sign-off.

## What the spike confirmed

- Celo is a supported network for **USDT**, **USDC** and **cNGN**.
- NGN is an active corridor with **bank** and **mobile** delivery.
- Off-ramp and on-ramp use the same endpoint: `POST /v2/sender/orders`.
- **Minimum order: $0.50 on most chains.** The docs do not separately state a Celo minimum. Some networks enforce a minimum of **1 unit** of the stablecoin (the API returns `"Amount is below the minimum of 1 for this network"`). Confirm Celo with Paycrest support before the smoke test.
- Paycrest runs on **mainnet only**. There is no sandbox.
- A **Sender** must complete **KYB** (typically 1–3 business days) at `https://app.paycrest.io`.
- The API uses an **API-Key** header and an **API Secret** for webhook signature verification.
- **Off-ramp `source.kyc` is optional** in the API. **`destination.kyc` is optional** too. This is different from on-ramp, where `source.kyc` is mandatory. Senders still own their local regulatory obligations; legal review is still required, but the API does not force GoodCash to collect customer KYC on an off-ramp.
- Every request and response uses **strings** for numeric fields in v2.

## Celo token facts from Paycrest

| Token | Celo address | Decimals |
| --- | --- | --- |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 |
| cNGN | `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` | 6 |

Use `GET /tokens` for the live list. Do not hardcode decimals; BNB Smart Chain USDT/USDC are 18 decimals, and the docs explicitly warn about this.

## Off-ramp request

`POST https://api.paycrest.io/v2/sender/orders`

```json
{
  "amount": "0.50",
  "source": {
    "type": "crypto",
    "currency": "USDT",
    "network": "celo",
    "refundAddress": "0xUserWallet"
  },
  "destination": {
    "type": "fiat",
    "currency": "NGN",
    "recipient": {
      "institution": "GTBINGLA",
      "accountIdentifier": "0123456789",
      "accountName": "John Doe",
      "memo": "GoodCash"
    }
  },
  "reference": "goodcash-<uuid>"
}
```

Notes:

- `amount` is in crypto units by default. `amountIn: "fiat"` would make it a fiat amount.
- Omit `rate` to let Paycrest resolve a valid rate. If the UI shows a locked rate, fetch it from `GET /v2/rates/celo/USDT/<amount>/NGN` and pass `data.sell.rate`; it must stay within market tolerance.
- `destination.providerIds` can pin up to three ranked providers. It is optional.
- `senderFee` or `senderFeePercent` is optional. If greater than zero, a `senderFeeAddress` (or profile fee address) is required. MVP should leave the fee at zero.
- `transactionFeePayer` is `"sender"` (default) or `"customer"`. With no sender fee, both behave the same for the customer.

## Off-ramp response

```json
{
  "id": "550e8400-...",
  "status": "initiated",
  "providerAccount": {
    "network": "celo",
    "receiveAddress": "0xProviderReceiveAddress",
    "validUntil": "2026-11-04T15:35:00Z",
    "amountToTransfer": "0.50",
    "currency": "USDT",
    "memo": "optional"
  },
  "senderFee": "0",
  "transactionFee": "0.01"
}
```

The user must send **exactly** `providerAccount.amountToTransfer` of `providerAccount.currency` to `providerAccount.receiveAddress` on `providerAccount.network` before `validUntil`.

- `amountToTransfer` already equals `amount + senderFee + transactionFee`.
- A smaller deposit is not credited; it is returned to `refundAddress` (less network costs where applicable).
- If `providerAccount.memo` is present, it must be included with the deposit or the deposit cannot be credited.
- Do not compute the total client-side. Use the response fields.

## Statuses and webhooks

Order statuses: `initiated`, `deposited`, `pending`, `fulfilling`, `validated`, `settling`, `settled`, `expired`, `refunding`, `refunded`.

Webhook events: `payment_order.deposited`, `payment_order.pending`, `payment_order.validated`, `payment_order.settling`, `payment_order.settled`, `payment_order.refunding`, `payment_order.refunded`, `payment_order.expired`, `payment_order.compliance_hold`.

- For an NGN off-ramp, `payment_order.validated` means the provider confirmed fiat delivery. `payment_order.settled` means the order is complete.
- `paymentReference` is the bank/mobile receipt. It can be `null`; treat that as normal.
- Verify `X-Paycrest-Signature` with HMAC-SHA256 using the API Secret. Compare hex strings with timing-safe equality; trim and lowercase the header first.
- Webhooks retry for a 24-hour window. Return 2xx quickly.

## KYC / KYB posture

- **GoodCash is the Sender.** It needs a KYB-verified business account and an API key.
- **Off-ramp customer KYC is optional in the API**, and the docs say to send only recipient KYC (`destination.kyc`) if used. This is better for the product than the earlier assumption that every user must be KYC'd.
- The docs also state that senders own their local regulatory obligations. That does not disappear because a field is optional. A Nigerian lawyer must confirm whether GoodCash's off-ramp flow triggers money-transmission, agent, or AML obligations, and whether the partner or GoodCash owns customer checks.
- Do not market "no KYC." Say "the partner handles the payout; we do not store your bank details" only if that is true in the final flow.

## Recommended flow for GoodCash

1. User swaps G$ to USDT on Celo.
2. Backend creates the order (API key server-side only) and returns `receiveAddress`, `amountToTransfer`, `currency`, `network`, `validUntil`, `memo`.
3. The user's wallet sends exactly `amountToTransfer` to `receiveAddress` before `validUntil`.
4. Backend polls or receives webhooks; client shows pending/success/failure.
5. Never hold the USDT. Never ask the user to send to an address that is not the current order's `receiveAddress`.

## Open items before the smoke test

- Confirm the Celo minimum with Paycrest support (docs say $0.50 for most chains; some networks enforce 1 unit).
- Confirm NGN provider liquidity at small sizes ($0.50–$5) and whether providers reject dust orders in practice.
- Complete KYB and obtain an API key/secret.
- Confirm the legal/KYC posture with Nigerian counsel.
- Decide whether to use `GET /v2/rates` for display or let create resolve the rate. If displaying, use `data.sell.rate` for off-ramp and show it as an estimate with a timestamp.
- Decide whether to support cNGN as a second payout token. Paycrest supports cNGN on Celo, but GoodCash would still need a liquid G$→cNGN route; do not assume one exists.
