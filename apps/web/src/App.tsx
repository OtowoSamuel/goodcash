const chainId = 42220;

function App() {
  return (
    <main className="shell">
      <div className="card">
        <p className="eyebrow">GoodDollar to naira</p>
        <h1>GoodCash</h1>
        <p className="status">Connected on chain {chainId}</p>
      </div>
    </main>
  );
}

export default App;
