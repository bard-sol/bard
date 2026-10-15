// Bard duel v1 icons. Extends the v3 set (../../prototype/v3/icons.js): same 24×24 grid, 1.75 stroke, round caps, currentColor.
Object.assign(window.BARD_ICONS, {
  // ── card types (3) ──
  // Character: a standing figure drawn as a pen bust on a plinth line
  t_character:  '<circle cx="12" cy="7" r="3.4"/><path d="M5.5 20.5c.4-4.6 3-7.2 6.5-7.2s6.1 2.6 6.5 7.2"/><path d="M3.5 20.5h17"/>',
  // Inkwork: a quill nib shedding one drop (a spell is ink spent)
  t_inkwork:    '<path d="M14.5 3.5l6 6-7.5 7.5-4.5 1.5 1.5-4.5z"/><path d="M13 9.5l-2.5 6.5"/><circle cx="12.1" cy="12.6" r=".9" fill="currentColor"/><path d="M5.5 15.5c-1.6 2-2 3.3-2 4a2 2 0 0 0 4 0c0-.7-.4-2-2-4z"/>',
  // Marginalia: a margin note with a folded corner and a manicule (pointing hand) mark
  t_marginalia: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4"/><path d="M8 14h7M12 10.5l3 3.5-3 3.5"/>',
  // ── duel keywords ──
  bound:        '<rect x="3" y="9" width="9" height="6" rx="3"/><rect x="12" y="9" width="9" height="6" rx="3"/><path d="M9.5 12h5"/>',
  swift:        '<path d="M4 8h9.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M5 17h5"/>',
  hidden:       '<path d="M3 11c2.4 3 5.4 4.5 9 4.5s6.6-1.5 9-4.5"/><path d="M6 14.2l-1.6 2.3M10 15.4l-.6 2.6M14 15.4l.6 2.6M18 14.2l1.6 2.3"/>',
  opening_line: '<path d="M10 7.5c-3 .9-4.8 3.3-5 7"/><circle cx="7.6" cy="14.6" r="2.6" fill="currentColor"/><path d="M18.5 7.5c-3 .9-4.8 3.3-5 7"/><circle cx="16.1" cy="14.6" r="2.6" fill="currentColor"/>',
  last_word:    '<path d="M5 16.5c3-.9 4.8-3.3 5-7"/><circle cx="7.4" cy="9.4" r="2.6" fill="currentColor"/><path d="M13.5 16.5c3-.9 4.8-3.3 5-7"/><circle cx="15.9" cy="9.4" r="2.6" fill="currentColor"/><path d="M4 20.5h16"/>',
  cleave:       '<path d="M4 19C8 13 13 8.5 20 5"/><path d="M5 12.5c2.2-.8 4.2-.9 6-.3"/><path d="M12 19.5c.6-2.2 1.8-4 3.6-5.3"/><path d="M17 5l3 0 0 3"/>',
  kindle:       '<path d="M12 3c2.8 3.2 4.4 5.6 4.4 8a4.4 4.4 0 0 1-8.8 0c0-1.6.8-3 2-4.2.2 1.4.9 2.3 1.9 2.7C11 7.5 11.3 5.3 12 3z"/><path d="M9 20.5h6"/><path d="M12 15.4v5.1"/>',
  riposte:      '<path d="M4 20l9-9"/><path d="M5.8 13.2l5 5"/><path d="M13 11l7-7"/><path d="M20 10.5A8 8 0 0 0 13.5 4"/><path d="M13.5 4l2 -1.6M13.5 4l1.7 1.9"/>',
  board:        '<path d="M3 15.5c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0"/><path d="M3 19.5c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0"/><path d="M6 12.5l12-5"/><path d="M15 6.2l3 1.3-1.3 3"/>',
  // ── duel resources & board ──
  ink:          '<path d="M12 3.2c3.4 4.4 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.6-6.6 6-11z"/>',
  ink_f:        '<path d="M12 3.2c3.4 4.4 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.6-6.6 6-11z" fill="currentColor"/>',
  verse:        '<path d="M5 20.5c3.5-1 6.4-3.2 8.6-6.4L20 4.5c-4.3 1.8-8 4.8-10.6 8.6"/><path d="M9.4 13.1L5 20.5"/><path d="M11.8 16.6c-1.4-.2-2.6-.8-3.4-1.6"/>',
  legend:       '<path d="M4 17.5l1.4-9 4.1 3.6L12 5.5l2.5 6.6 4.1-3.6 1.4 9z"/><path d="M4 20.5h16"/>',
  tired:        '<path d="M6 3.5h12M6 20.5h12"/><path d="M7.5 3.5c0 4 4.5 5.2 4.5 8.5S7.5 16.5 7.5 20.5M16.5 3.5c0 4-4.5 5.2-4.5 8.5s4.5 4.5 4.5 8.5"/><path d="M10 18.5h4"/>',
  hold:         '<path d="M6 21V3.5"/><path d="M6 4.5h11l-2.5 3.5L17 11.5H6"/>',
  conquer:      '<path d="M6 21V3.5"/><path d="M6 4.5h11l-2.5 3.5L17 11.5H6"/><path d="M14 15l5 5M19 15l-5 5"/>',
  page:         '<path d="M12 6.5C10 5.2 7 4.8 3.5 5.3v13c3.5-.5 6.5-.1 8.5 1.2 2-1.3 5-1.7 8.5-1.2v-13c-3.5-.5-6.5-.1-8.5 1.2z"/><path d="M12 6.5v13"/>',
  help:         '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  deck:         '<rect x="6.5" y="4" width="11" height="15" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/>',
  hand:         '<rect x="3" y="7" width="8" height="12" rx="1.5" transform="rotate(-10 7 13)"/><rect x="10" y="5" width="8" height="12" rx="1.5" transform="rotate(8 14 11)"/>',
  arrow_r:      '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev_d:       '<path d="M6 9l6 6 6-6"/>',
  chev_u:       '<path d="M6 15l6-6 6 6"/>',
  check:        '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert:        '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  tap:          '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15c0 3.3-2.2 5.5-5.5 5.5-2.4 0-3.9-1-5-2.9L5.3 14a1.5 1.5 0 0 1 2.4-1.7L9 14"/>',
  move:         '<path d="M4 9h13M13 5l4 4-4 4"/><path d="M20 15H7M11 19l-4-4 4-4"/>',
  heal:         '<path d="M12 5v14M5 12h14"/>',
  timer:        '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>',
  burn:         '<path d="M12 3c3 3.5 5.5 6.5 5.5 10a5.5 5.5 0 0 1-11 0c0-2 .9-3.6 2.2-5 .3 1.7 1 2.6 2.2 3.1C10.5 8 11 5.4 12 3z"/>',
  dot:          '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
});
// Which keyword icon each v1.3 keyword uses.
window.KWI = { bound:'bound', ward:'ward', swift:'swift', hidden:'hidden', opening_line:'opening_line', last_word:'last_word', silence:'silence', cleave:'cleave', kindle:'kindle', riposte:'riposte', board:'board' };
window.TYPEI = { character:'t_character', inkwork:'t_inkwork', marginalia:'t_marginalia' };
