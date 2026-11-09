import React from 'react';
import { createRoot } from 'react-dom/client';
import { GoodCashProvider, CashOutButton, CashOutFlow } from '@goodcash/react';

const KEY = import.meta.env.VITE_GOODCASH_KEY ?? 'gc_pk_test_REPLACE_ME';

function App() {
  return (
    <GoodCashProvider publishableKey={KEY} theme={{ mode: 'auto' }}>
      <main style={{ fontFamily: 'system-ui', padding: 24, display: 'grid', gap: 24, maxWidth: 480 }}>
        <h1>My app</h1>
        <CashOutButton partnerRef="user-1" onEvent={(e) => console.log(e)} />
        <h2>Or inline</h2>
        <CashOutFlow partnerRef="user-1" />
      </main>
    </GoodCashProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
