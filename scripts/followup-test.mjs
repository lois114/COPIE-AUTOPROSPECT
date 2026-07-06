// Logique « à relancer » + câblage de l'onglet dans index.html.
// needsFollowup est une fonction pure : on l'extrait du HTML et on la teste
// pour de vrai. Le reste vérifie que le câblage est bien présent.
// node scripts/followup-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = html.match(re);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < html.length && depth > 0) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    i++;
  }
  return html.slice(m.index, i);
}

test('needsFollowup : comportement sur les statuts et délais', () => {
  const src = extractFn('needsFollowup');
  assert.ok(src, 'needsFollowup introuvable dans index.html');

  // eslint-disable-next-line no-eval
  const needsFollowup = (0, eval)('(' + src + ')');
  const DAY = 86400000;
  const now = 1_000_000_000_000;
  const ago = (days) => new Date(now - days * DAY).toISOString();

  assert.equal(needsFollowup({ status: 'opened', sentAt: ago(10) }, 3, now), false);
  assert.equal(needsFollowup({ status: 'clicked', sentAt: ago(10) }, 3, now), false);
  assert.equal(needsFollowup({ status: 'sent', sentAt: ago(1) }, 3, now), false);
  assert.equal(needsFollowup({ status: 'sent', sentAt: ago(4) }, 3, now), true);
  assert.equal(needsFollowup({ status: 'delivered', sentAt: ago(5) }, 3, now), true);
  assert.equal(needsFollowup({ status: 'bounced', sentAt: ago(10) }, 3, now), false);
  assert.equal(needsFollowup({ status: 'spam', sentAt: ago(10) }, 3, now), false);
  assert.equal(needsFollowup({ status: 'sent' }, 3, now), false);
  // borne exacte : pile le délai => à relancer (comparaison >=)
  assert.equal(needsFollowup({ status: 'sent', sentAt: ago(3) }, 3, now), true);
});

test('réglage followupDays', () => {
  assert.match(html, /followupDays:\s*3/);
  assert.match(html, /id="followup-days"/);
  assert.match(html, /config\.followupDays\s*=\s*Math\.max\(1,\s*parseInt\(document\.getElementById\('followup-days'\)/);
  assert.match(html, /getElementById\('followup-days'\)\.value\s*=\s*config\.followupDays/);
});

test('capture de sentAt depuis les stats', () => {
  assert.match(html, /if\s*\(s\.created_at\)\s*p\.sentAt\s*=\s*s\.created_at/);
});

test('onglet À relancer : câblage complet', () => {
  assert.match(html, /let\s+prospectView\s*=\s*'all'/);
  assert.match(html, /id="tab-followup"/);
  assert.match(html, /function\s+setProspectView\s*\(/);
  assert.match(html, /function\s+getFollowupProspects\s*\(/);
  assert.match(html, /À relancer \(\$\{n\}\)/);
  assert.match(html, /prospectView\s*===\s*'followup'/);
  assert.match(html, /envoyé il y a \$\{daysSince\(p\.sentAt\)\} j/);
  assert.match(html, /prospects\.forEach\(updateRow\);\s*renderProspects\(/);
});

test('export suit la vue active', () => {
  assert.match(html, /const scope = prospectView === 'followup' \? getFollowupProspects\(\) : getActiveProspects\(\)/);
  assert.match(html, /viewSuffix\s*=\s*prospectView === 'followup' \? '_a-relancer'/);
});

test('filtre par statut', () => {
  assert.match(html, /id="status-filter"/);
  assert.match(html, /function\s+setStatusFilter\s*\(/);
  assert.match(html, /if\s*\(statusFilter\)\s*pool\s*=\s*pool\.filter\(p\s*=>\s*p\.status\s*===\s*statusFilter\)/);
  assert.match(html, /<th>Statut \$\{statusFilterSelectHtml\(\)\}/);
  assert.match(html, /emptyStateHtml\(filter\)/);
});
