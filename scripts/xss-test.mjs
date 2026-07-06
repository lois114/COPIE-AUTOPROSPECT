// escapeHTML (extrait de index.html) doit neutraliser les payloads XSS.
// node scripts/xss-test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// On récupère la vraie fonction depuis le HTML (pas une copie) pour tester
// exactement ce qui tourne dans le navigateur.
const match = html.match(/function escapeHTML\s*\([\s\S]+?\n\s{4}\}/);
if (!match) {
  console.error('escapeHTML introuvable dans index.html');
  process.exit(1);
}
const escapeHTML = new Function('return ' + match[0])();

let failures = 0;
function expect(label, cond, info = '') {
  if (cond) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${label}${info ? '  ' + info : ''}`);
}

console.log('\nPayloads XSS connus\n');

const payloads = [
  // Vol de token via image piégée — l'attaque mentionnée dans l'audit
  `<img src=x onerror="fetch('/api/send',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.paddle_token},body:JSON.stringify({to:'attacker@evil.com',subject:'pwn',body:'hijack'})})">`,
  `<script>alert('XSS')</script>`,
  `" onmouseover="alert(1)`,
  `<iframe src="javascript:alert('XSS')"></iframe>`,
  `<svg onload=alert(1)>`,
  `'><script>alert(1)</script>`,
];

for (const p of payloads) {
  const escaped = escapeHTML(p);
  expect(
    `payload (${p.slice(0, 35)}...) neutralisé`,
    !escaped.includes('<') && !escaped.includes('>') && !escaped.includes('"') && !escaped.includes("'"),
    `→ "${escaped}"`
  );
}

console.log('\nCas normaux (l\'affichage doit rester lisible)\n');

expect('Texte simple inchangé', escapeHTML('Société Dupont') === 'Société Dupont');
expect('Accents préservés', escapeHTML('Café à l\'angle') === 'Café à l&#39;angle');
expect('null → chaîne vide', escapeHTML(null) === '');
expect('undefined → chaîne vide', escapeHTML(undefined) === '');
expect('Nombre converti', escapeHTML(42) === '42');

console.log('\nAudit statique : aucun ${p.X} rendu sans échappement\n');

// Les seuls ${p.X} bruts tolérés : clés de Set (dedup, non rendues) et
// affectations déjà sûres (showAlert / textContent / .value).
const lines = html.split('\n');
const dangerousFields = ['p.name', 'p.company', 'p.title', 'p.email', 'p.city', 'p.department'];
const allowedContexts = [/showAlert/, /textContent\s*=/, /\.value\s*=/, /new Set\(/, /existingKeys/, /const key/];

const dangerous = [];
lines.forEach((line, i) => {
  for (const field of dangerousFields) {
    const rx = new RegExp(`\\$\\{${field.replace('.', '\\.')}[^}]*\\}`);
    if (!rx.test(line)) continue;
    if (line.includes(`escapeHTML(${field}`)) continue;
    if (allowedContexts.some(p => p.test(line))) continue;
    dangerous.push(`L${i + 1}: ${line.trim()}`);
  }
});

expect(
  'Aucun ${p.X} brut injecté en HTML',
  dangerous.length === 0,
  dangerous.length ? '\n      ' + dangerous.join('\n      ') : ''
);

console.log(`\n${failures ? failures + ' échec(s)' : 'aucun échec'}`);
if (failures > 0) process.exit(1);
