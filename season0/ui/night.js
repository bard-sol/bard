import { bardAvatarSrc, bardNightMood } from './bard.js';
import { annotationCommit, canonicalAnnotationText, SEASON_SEALS } from '../lib/annotations.js';

const params = new URLSearchParams(location.search);
const fromPath = location.pathname.match(/\/play\/night\/(\d+)/) || location.pathname.match(/\/night\/(\d+)/);
const chapter = params.get('chapter') || (fromPath && fromPath[1]) || '1';
const voided = params.get('void');

const beats = voided ? [
  'Not tonight. The ink spilled.',
  'Chapter ' + chapter + ' is voided. Nobody is marked.',
  'Stakes come back. Train credit stays. Picks score nothing and do not use the cap.',
  'The rerun uses a normal prediction window.'
] : [
  'Chapter ' + chapter + '. I have been watching.',
  'The choices are in. Triumph, success, setback, disaster. Luck had a hand in all of them.',
  'The top squads are named. Five members was the line.',
  'Standings, from the margin upward. Someone survived by a narrow percent.',
  'The page turns.',
  'Last words, or the line the ink kept.',
  'Revival is open. Anyone can burn tBard. No refunds.',
  'Verify the chapter. The memo hash matches the Supabase file and the GitHub mirror.'
];

let index = 0;
const beat = document.getElementById('beat');
const note = document.getElementById('note');
const face = document.getElementById('bard');
const openedBox = document.getElementById('opened');
document.getElementById('back').href = '/play/?phase=P7&chapter=' + chapter + (voided ? '&void=' + voided : '');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function show() {
  const mood = bardNightMood(index, !!voided);
  face.src = bardAvatarSrc(mood);
  face.dataset.bardMood = mood;
  beat.textContent = beats[index];
  note.textContent = (index + 1) + ' / ' + beats.length + ' · tap or wait · chapter ' + chapter;
}

document.getElementById('next').addEventListener('click', () => {
  index = Math.min(beats.length - 1, index + 1);
  show();
});
document.getElementById('skip').addEventListener('click', () => {
  index = beats.length - 1;
  show();
});
beat.addEventListener('click', () => {
  index = Math.min(beats.length - 1, index + 1);
  show();
});
async function loadOpened() {
  const ann = params.get('ann') || '';
  if (!ann || !openedBox) return;
  const q = new URLSearchParams({ open: ann, chapter, tx: params.get('tx') || '' });
  const view = await fetch('/api/season/annotations?' + q).then((r) => r.json());
  const rows = view.opened || [];
  if (!rows.length) return;
  for (const row of rows) beats.splice(4, 0, row.text);
  openedBox.innerHTML = rows.map((row) =>
    '<section class="banner info" data-banner="annotation-' + esc(row.id) + '"><strong>Annotation ' + esc(row.id) + '</strong><p>' + esc(row.text) + '</p>' +
    (row.href
      ? '<a class="btn" href="' + esc(row.href) + '" data-seal-tx>Memo transaction</a>'
      : '<span class="meta" data-seal-memo>' + esc(row.memo || view.memo || '') + '</span>') +
    '<button class="btn" type="button" data-act="verify-seal" data-id="' + esc(row.id) + '">Verify hash</button></section>'
  ).join('');
  openedBox.querySelectorAll('[data-act="verify-seal"]').forEach((node) => {
    node.addEventListener('click', async () => {
      const row = rows.find((item) => item.id === node.dataset.id);
      const seal = (SEASON_SEALS.seals || []).find((item) => item.id === node.dataset.id);
      if (!row || !seal) return;
      const hash = await annotationCommit(row.salt, canonicalAnnotationText('s0', row.id, row.text));
      const ok = hash === seal.commit;
      node.dataset.sealResult = ok ? 'match' : 'mismatch';
      node.textContent = ok ? 'Hash matches' : 'Hash does not match';
    });
  });
  show();
}

loadOpened().catch(() => {});
show();
setInterval(() => {
  if (index < beats.length - 1) {
    index += 1;
    show();
  }
}, 6000);
