# Webhooks

Set your endpoint once per mode with your **secret key**:

```bash
curl -X PUT https://api.goodcash.xyz/v1/webhooks \
  -H "Authorization: Bearer $GOODCASH_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://your-server.example/goodcash"}'
```

The response contains `secret` (`whsec_...`) **once**. Store it. Lost it? Send `"rotateSecret": true`.
`POST /v1/webhooks/test` sends a signed `cashout.test` event.

## Events

`cashout.paid`, `cashout.failed`, `cashout.refunded`, `cashout.expired` (never signed), `cashout.delayed`
(not paid 25 minutes after sending), `cashout.test`. `data` is the cash out (same as `GET /v1/cashouts/{id}`).

If top-ups (naira in) are switched on for you: `topup.paid_in` (the naira arrived), `topup.delivered` (the G$ or CELO is in
the wallet), `topup.failed` (expired or refunded). `data` is the top-up (same as `GET /v1/topups/{id}`). See
[Add G$ / CELO with naira](quickstarts/topups.md).

Each event is sent once per change, at once; failures are retried after about 10 min, 30 min, 2 h and 12 h.
Answer 2xx within 5 seconds. The same event may arrive twice: ignore an `id` you have already handled.

## Verify every webhook

Header: `GoodCash-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`.
Use the **raw** body (before JSON parsing). Reject if `t` is more than 5 minutes from now.

### Node (with the SDK)
```js
import { verifyWebhook } from '@goodcash/sdk/server';
const event = await verifyWebhook(rawBody, req.headers['goodcash-signature'], process.env.GOODCASH_WEBHOOK_SECRET);
```

### Node (no dependencies)
```js
import crypto from 'node:crypto';
function verify(raw, header, secret) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header || '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${m[1]}.${raw}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}
```

### Python
```python
import hmac, hashlib, re, time
def verify(raw: bytes, header: str, secret: str) -> bool:
    m = re.fullmatch(r"t=(\d+),v1=([0-9a-f]{64})", header or "")
    if not m or abs(time.time() - int(m.group(1))) > 300:
        return False
    want = hmac.new(secret.encode(), m.group(1).encode() + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, m.group(2))
```

### Go
```go
func Verify(raw []byte, header, secret string) bool {
	var t int64; var sig string
	if _, err := fmt.Sscanf(header, "t=%d,v1=%s", &t, &sig); err != nil { return false }
	if d := time.Now().Unix() - t; d > 300 || d < -300 { return false }
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", t))); mac.Write(raw)
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(sig))
}
```
