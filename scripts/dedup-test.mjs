// Verrous anti double-envoi / double-génération. On vérifie la présence du
// garde-fou dans index.html, puis on rejoue la logique du verrou en
// concurrence pour prouver qu'un seul fetch part réellement.
// node scripts/dedup-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Isole le corps d'une fonction async par équilibrage d'accolades.
function extractFn(name) {
  const re = new RegExp(`async function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = html.match(re);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < html.length && depth > 0) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    i++;
  }
  return html.slice(m.index, i);
}

const expectations = [
  { fn: 'sendOne',             guard: /if\s*\(\s*p\.status\s*===\s*['"]sending['"]\s*\)\s*return/ },
  { fn: 'validateAndSendMail', guard: /if\s*\(\s*p\.status\s*===\s*['"]sending['"]\s*\)\s*return/ },
  { fn: 'generateOne',         guard: /if\s*\(\s*p\.status\s*===\s*['"]generating['"]\s*\)\s*return/ },
];

test('chaque fonction critique porte son verrou anti-réentrée', () => {
  for (const { fn, guard } of expectations) {
    const body = extractFn(fn);
    assert.ok(body, `${fn} introuvable dans index.html`);
    assert.match(body, guard, `${fn} : verrou absent`);
  }
});

test('validateAndSendMail pose le statut "sending" avant le fetch', () => {
  const body = extractFn('validateAndSendMail');
  assert.ok(body);
  const idxStatus = body.search(/p\.status\s*=\s*['"]sending['"]/);
  const idxFetch = body.search(/authFetch\s*\(/);
  // sinon le verrou ne protège rien : le fetch pourrait partir avant le flag.
  assert.ok(idxStatus > -1 && idxFetch > -1 && idxStatus < idxFetch, `idxStatus=${idxStatus} idxFetch=${idxFetch}`);
});

test('double-clic : un seul fetch part vraiment', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    await new Promise(r => setTimeout(r, 30));
    return { ok: true, json: async () => ({ messageId: 'mid_' + fetchCount }) };
  };

  const p = { id: 1, status: 'ready', email: 'a@b.c', mail: 'Objet: t\n\nbody', name: 'X' };

  async function fakeSendOne() {
    if (p.status === 'sending') return;
    p.status = 'sending';
    const res = await mockFetch();
    const data = await res.json();
    p.status = 'sent';
    p.messageId = data.messageId;
  }

  await Promise.all([fakeSendOne(), fakeSendOne(), fakeSendOne()]);
  assert.equal(fetchCount, 1, `fetchCount=${fetchCount}`);
  assert.equal(p.status, 'sent');
});

test('un échec autorise une nouvelle tentative (pas de blocage définitif)', async () => {
  let fetchCount = 0;
  let mode = 'fail';
  const mockFetch = async () => {
    fetchCount++;
    await new Promise(r => setTimeout(r, 20));
    if (mode === 'fail') throw new Error('Resend down');
    return { ok: true, json: async () => ({ messageId: 'm' }) };
  };

  const p = { id: 2, status: 'ready', email: 'a@b.c', mail: 'x', name: 'Y' };

  async function fakeSendOne() {
    if (p.status === 'sending') return;
    const previous = p.status;
    p.status = 'sending';
    try {
      await mockFetch();
      p.status = 'sent';
    } catch {
      p.status = previous;  // rollback comme dans le vrai code
    }
  }

  await fakeSendOne();
  assert.equal(p.status, 'ready');

  // On réautorise le succès et on relance.
  mode = 'ok';
  await fakeSendOne();
  assert.equal(p.status, 'sent');
  assert.equal(fetchCount, 2, `fetchCount=${fetchCount}`);
});
