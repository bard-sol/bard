const out = document.getElementById('out');

function show(value) {
  out.textContent = JSON.stringify(value, null, 2);
}

async function get(path) {
  const res = await fetch(path);
  show(await res.json());
}

document.getElementById('health').addEventListener('click', () => get('/api/season/health'));
document.getElementById('config').addEventListener('click', () => get('/api/season/config'));

document.getElementById('publish').addEventListener('click', async () => {
  const chapter = Number(document.getElementById('chapter').value);
  const res = await fetch('/api/season/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { season: 's0', chapter, status: 'final', note: 'control-room preview' } })
  });
  show(await res.json());
});

document.getElementById('void').addEventListener('click', async () => {
  const chapter = Number(document.getElementById('chapter').value);
  const reason = document.getElementById('reason').value;
  const stakes = Array.from({ length: 10 }, (_, i) => ({
    sig: 'StakeSig' + i + 'xxxx',
    wallet: 'Wallet' + i,
    amount: 10
  }));
  const res = await fetch('/api/season/void', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ season: 's0', chapter, reason, stakes, state: { scores: [] } })
  });
  show(await res.json());
});
