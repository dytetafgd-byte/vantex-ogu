// puzzles.js — small daily games that pay badges/credits so the site isn't
// boring, but can't be farmed: one submission per game per day, fixed answers,
// server-side checking.
import { one, run, all } from './db.js';
import { run as exec } from './db.js';

const WORDS = ['pumpkin','skeleton','cobweb','hollow','ember','lantern',
  'midnight','shiver','attic','raven','harvest','foggy','candle','moonlit'];

// deterministic day key so everyone gets the same puzzle and nobody can reroll
const dayKey = () => new Date().toISOString().slice(0, 10);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function todaysWord() {
  return WORDS[hash(dayKey()) % WORDS.length];
}

const REWARDS = { wordle: 3, riddle: 2 };

export function puzzleState(userId) {
  const day = dayKey();
  const plays = all('SELECT game, won FROM puzzle_plays WHERE user_id = ? AND day = ?', userId, day);
  return {
    day,
    wordLength: todaysWord().length,
    played: Object.fromEntries(plays.map(p => [p.game, !!p.won])),
  };
}

// Guess is scored like wordle: exact / present / absent, no answer leaked.
export function submitGuess(user, guess) {
  if (!user?.id) return { error: 'Log in first.' };
  const day = dayKey();
  const g = String(guess || '').toLowerCase().trim();
  const answer = todaysWord();
  if (!/^[a-z]{4,12}$/.test(g)) return { error: 'Letters only, 4-12 characters.' };
  if (g.length !== answer.length) return { error: `That word is ${answer.length} letters.` };

  const already = one(`SELECT won FROM puzzle_plays WHERE user_id = ? AND day = ? AND game = 'wordle'`,
    user.id, day);
  if (already?.won) return { error: 'Already solved today. Come back tomorrow.' };

  const marks = [];
  const pool = answer.split('');
  for (let i = 0; i < g.length; i++) {
    if (g[i] === answer[i]) { marks.push('exact'); pool[i] = null; }
    else if (pool.includes(g[i])) { marks.push('present'); pool[pool.indexOf(g[i])] = null; }
    else marks.push('absent');
  }

  if (g === answer) {
    run(`INSERT INTO puzzle_plays (user_id,day,game,won) VALUES (?,?, 'wordle',1)
         ON CONFLICT(user_id,day,game) DO UPDATE SET won = 1`, user.id, day);
    exec('UPDATE users SET credits = credits + ? WHERE id = ?', REWARDS.wordle, user.id);
    return { ok: true, won: true, marks, reward: REWARDS.wordle };
  }
  return { ok: true, won: false, marks };
}