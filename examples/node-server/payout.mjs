/**
 * Server example (test mode, no wallet needed):
 *   GOODCASH_SECRET_KEY=gc_sk_test_... node payout.mjs
 * Optional: GOODCASH_API=http://localhost:8787 to use a local worker.
 */
import { GoodCash } from '@goodcash/sdk';

const gc = new GoodCash({ secretKey: process.env.GOODCASH_SECRET_KEY, baseUrl: process.env.GOODCASH_API });

const quote = await gc.quote({ amountG: '5000' });
console.log(`5,000 G$ -> about NGN ${quote.receive.naira} (at least ${quote.receive.minimumNaira})`);
for (const f of quote.fees) console.log(`  ${f.label}: ${f.amountG ? f.amountG + ' G$' : 'NGN ' + f.naira}`);

const banks = await gc.banks();
const { accountName } = await gc.verifyAccount({ bankCode: banks[0].code, accountNumber: '0123456789' });
console.log(`Paying ${accountName} at ${banks[0].name}`);

const { cashOut } = await gc.cashOut({
  amountG: '5000',
  recipient: { bankCode: banks[0].code, accountNumber: '0123456789', accountName },
  quote,
  partnerRef: 'example-user-1',
});
console.log(`Cash out ${cashOut.id}: ${cashOut.status}`);

const final = await gc.watchCashOut(cashOut.id, (c) => console.log(`  status: ${c.status}`));
console.log(`Done: ${final.status}`);
