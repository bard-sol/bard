import { CAST } from './cast.js';

export const QUIZ = [
  { id: 'fight', prompt: 'When the page turns, you…', options: ['Hit it', 'Rewrite it', 'Charm it', 'Trust luck'] },
  { id: 'company', prompt: 'You would rather travel with…', options: ['A chain', 'A quill', 'A fan', 'A coin'] },
  { id: 'fear', prompt: 'The worse fate is…', options: ['A fair fight', 'A true draft', 'Being forgotten', 'A sure thing'] },
  { id: 'page', prompt: 'The last line should be…', options: ['Loud', 'Clever', 'Kind', 'Shared'] }
];

export function suggestCharacter(answers) {
  const score = (answers || []).reduce((sum, n) => sum + (Number(n) || 0), 0);
  return CAST[score % CAST.length];
}

export function storyPage(id) {
  const character = CAST.find((c) => c.id === id);
  if (!character) return null;
  return {
    id: character.id,
    name: character.name,
    hook: character.hook,
    voice: character.voice,
    fallback: character.fallback
  };
}
