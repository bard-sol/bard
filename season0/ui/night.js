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
document.getElementById('back').href = '/play/?phase=P7&chapter=' + chapter + (voided ? '&void=' + voided : '');

function show() {
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
show();
setInterval(() => {
  if (index < beats.length - 1) {
    index += 1;
    show();
  }
}, 6000);
