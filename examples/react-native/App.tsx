import 'react-native-get-random-values'; // crypto.getRandomValues for the SDK
import React, { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { GoodCash } from '@goodcash/sdk';

// Publishable key + your registered app id (React Native has no web origin)
const gc = new GoodCash({ publishableKey: 'gc_pk_test_REPLACE_ME', appId: 'com.example.app' });

export default function App({ walletProvider }: { walletProvider: { request: (a: { method: string; params?: unknown }) => Promise<unknown> } }) {
  const [status, setStatus] = useState('');
  async function cashOut() {
    try {
      const quote = await gc.quote({ amountG: 5000 });
      const banks = await gc.banks();
      const { accountName } = await gc.verifyAccount({ bankCode: banks[0].code, accountNumber: '0123456789' });
      const { cashOut } = await gc.cashOut({ signer: walletProvider, amountG: 5000, recipient: { bankCode: banks[0].code, accountNumber: '0123456789', accountName }, quote });
      await gc.watchCashOut(cashOut.id, (c) => setStatus(c.status));
    } catch (e) {
      setStatus((e as Error).message); // plain words, safe to show
    }
  }
  return (
    <View style={{ padding: 24 }}>
      <Button title="Cash out to bank" onPress={cashOut} />
      <Text>{status}</Text>
    </View>
  );
}
