/** Scoped styles: every class starts with gcw- and everything lives under .gcw, so it never clashes with the host app. */
export const CSS = `
.gcw{font-family:var(--gcw-font);color:var(--gcw-ink);background:var(--gcw-bg);border-radius:calc(var(--gcw-radius) + 6px);padding:20px;box-sizing:border-box;max-width:480px;width:100%;line-height:1.5;-webkit-font-smoothing:antialiased}
.gcw *{box-sizing:border-box}
.gcw-h{font-size:24px;font-weight:800;margin:0 0 6px;letter-spacing:-.3px}
.gcw-sub{font-size:15px;margin:0 0 14px;opacity:.85}
.gcw-card{background:var(--gcw-surface);border:2.5px solid var(--gcw-ink);border-radius:var(--gcw-radius);padding:16px;margin:0 0 14px;box-shadow:4px 4px 0 var(--gcw-ink)}
.gcw-card--ok{background:var(--gcw-success)}
.gcw-lab{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;opacity:.8;margin:0 0 10px;display:block}
.gcw-big{font-size:32px;font-weight:800;letter-spacing:-.6px}
.gcw-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:2px 10px;font-size:15px;padding:4px 0}
.gcw-row>:first-child{white-space:nowrap}
.gcw-row>:last-child:not(:first-child){margin-left:auto;text-align:right}
.gcw-input{width:100%;font:inherit;font-size:18px;font-weight:700;color:var(--gcw-ink);background:var(--gcw-surface);border:2.5px solid var(--gcw-ink);border-radius:calc(var(--gcw-radius) - 6px);padding:14px 16px;outline:none}
.gcw-input:focus-visible,.gcw-btn:focus-visible,.gcw-bank:focus-visible,.gcw-x:focus-visible{outline:3px solid var(--gcw-accent);outline-offset:2px}
.gcw-btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:54px;font:inherit;font-size:18px;font-weight:800;color:var(--gcw-accent-ink);background:var(--gcw-accent);border:2.5px solid var(--gcw-ink);border-radius:999px;box-shadow:4px 4px 0 var(--gcw-ink);cursor:pointer;margin-top:10px}
.gcw-btn:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--gcw-ink)}
.gcw-btn[disabled]{opacity:.55;cursor:not-allowed}
.gcw-btn--ghost{background:var(--gcw-surface);color:var(--gcw-ink)}
.gcw-note{font-size:15px;background:var(--gcw-surface);border:2px dashed var(--gcw-ink);border-radius:calc(var(--gcw-radius) - 6px);padding:12px 14px;margin:10px 0}
.gcw-err{font-size:15px;font-weight:700;background:#ffe1e1;color:#5a0000;border:2.5px solid #5a0000;border-radius:calc(var(--gcw-radius) - 6px);padding:12px 14px;margin:10px 0}
.gcw-steps{display:flex;gap:8px;margin:0 0 14px}
.gcw-step{flex:1;height:8px;border-radius:99px;border:2px solid var(--gcw-ink);background:var(--gcw-surface)}
.gcw-step--done{background:var(--gcw-success)}
.gcw-step--on{background:var(--gcw-accent)}
.gcw-banks{max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;margin-top:12px}
.gcw-bank{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;font-weight:700;color:var(--gcw-ink);background:var(--gcw-surface);border:2.5px solid var(--gcw-ink);border-radius:calc(var(--gcw-radius) - 6px);padding:13px 14px;cursor:pointer}
.gcw-bank[aria-selected=true]{background:var(--gcw-success)}
.gcw-chip{display:inline-block;font-size:12px;font-weight:800;background:var(--gcw-highlight);color:#111;border:2px solid var(--gcw-ink);border-radius:99px;padding:2px 8px}
.gcw-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 14px}
.gcw-top .gcw-h{flex:1;min-width:0;margin:0}
.gcw-x{flex:none;font:inherit;font-size:18px;font-weight:800;width:40px;height:40px;border-radius:99px;border:2.5px solid var(--gcw-ink);background:var(--gcw-surface);color:var(--gcw-ink);cursor:pointer}
.gcw-foot{font-size:13px;text-align:center;opacity:.75;margin-top:16px}
.gcw-spin{width:40px;height:40px;border-radius:99px;border:4px solid var(--gcw-ink);border-top-color:transparent;margin:10px auto;animation:gcw-spin 1s linear infinite}
@keyframes gcw-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.gcw-spin{animation:none;border-top-color:var(--gcw-ink)}.gcw-btn:active{transform:none}}
.gcw-overlay{position:fixed;inset:0;background:rgba(17,17,17,.55);display:flex;align-items:flex-end;justify-content:center;z-index:2147483000;padding:16px}
@media (min-width:560px){.gcw-overlay{align-items:center}}
.gcw-dialog{max-height:calc(100vh - 32px);overflow-y:auto;width:100%;max-width:480px;border:2.5px solid #111;border-radius:24px;box-shadow:6px 6px 0 #111}
.gcw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

let injected = false;
export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.querySelector('style[data-goodcash]')) {
    injected = true;
    return;
  }
  const el = document.createElement('style');
  el.setAttribute('data-goodcash', '');
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}
