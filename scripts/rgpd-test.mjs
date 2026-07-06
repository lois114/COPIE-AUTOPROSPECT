// La mention légale RGPD doit toujours finir sur les mails sortants :
//  - helpers _lib.js (unitaire)
//  - /api/generate ajoute le footer après la réponse de Groq (fetch mocké)
//  - /api/send le ré-injecte avant l'envoi (audit statique)
// node scripts/rgpd-test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

process.env.SITE_PASSWORD = 'test-pw';
process.env.GROQ_API_KEY = 'fake';

const { getLegalFooter, hasLegalFooter, ensureLegalFooter } = await import('../api/_lib.js');
const generateHandler = (await import('../api/generate.js')).default;

const errors = [];
function want(label, cond, detail = '') {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    errors.push(label);
    console.log(`  FAIL ${label}${detail ? '  (' + detail + ')' : ''}`);
  }
}

// Helpers purs
const footer = getLegalFooter();
want('Footer mentionne la source (Apollo.io)', footer.includes('Apollo.io'));
want('Footer mentionne le STOP', footer.toLowerCase().includes('stop'));
want('hasLegalFooter détecte la formulation par défaut', hasLegalFooter(footer));
want('hasLegalFooter tolère l\'absence d\'accent (repondez)', hasLegalFooter('Pour ne plus recevoir, repondez STOP svp.'));
want('hasLegalFooter rejette un mail sans footer', !hasLegalFooter('Bonjour, à bientôt.'));
want('hasLegalFooter sur null/undefined → false', !hasLegalFooter(null) && !hasLegalFooter(undefined));

const mail1 = 'Objet: T\n\nCorps.\n\nSignature';
const m1 = ensureLegalFooter(mail1);
want('ensureLegalFooter ajoute le footer quand absent', hasLegalFooter(m1));
want('le mail original est préservé', m1.startsWith('Objet: T'));

// deux passages ne doivent pas empiler deux footers
const m2 = ensureLegalFooter(m1);
want('ensureLegalFooter ne duplique pas le footer', (m2.match(/Apollo\.io/g) || []).length === 1);

process.env.LEGAL_FOOTER = '\n\nFooter custom répondez STOP.';
want('override LEGAL_FOOTER respecté', getLegalFooter().includes('Footer custom'));
delete process.env.LEGAL_FOOTER;

console.log('');

// /api/generate : on mocke Groq pour vérifier que le footer est apposé APRÈS.
const originalFetch = global.fetch;
global.fetch = async (url) => {
  if (String(url).includes('groq.com')) {
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Objet: Test\n\n3 phrases.\n\n— Jean' } }],
      }),
    };
  }
  return originalFetch(url);
};

function mockReqRes({ method = 'POST', headers = {}, body = {} } = {}) {
  const res = {
    statusCode: 200, _headers: {}, _body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    end() { return this; },
  };
  const req = { method, headers: { 'content-type': 'application/json', authorization: 'Bearer test-pw', ...headers }, body };
  return { req, res };
}

{
  const { req, res } = mockReqRes({
    body: { prospect: { name: 'X', company: 'Y' }, template: { paddleName: 'P', pitch: 'p', offer: 'o', signature: '— S' } },
  });
  await generateHandler(req, res);
  want('generate → 200', res.statusCode === 200, `reçu ${res.statusCode} : ${JSON.stringify(res._body)}`);
  want('le mail contient le corps généré', res._body?.mail?.includes('3 phrases'));
  want('le mail contient le footer Apollo.io', res._body?.mail?.includes('Apollo.io'));
  want('le mail contient l\'opt-out STOP', res._body?.mail?.toLowerCase().includes('stop'));
  want('footer présent une seule fois', (res._body?.mail?.match(/Apollo\.io/g) || []).length === 1);
}

global.fetch = originalFetch;

console.log('');

// /api/send : audit statique — ensureLegalFooter doit être appelé avant l'envoi.
const sendSrc = readFileSync(join(__dirname, '..', 'api', 'send.js'), 'utf8');
want('send.js importe ensureLegalFooter',
  /import\s*\{[^}]*ensureLegalFooter[^}]*\}\s*from\s*['"]\.\/_lib\.js['"]/.test(sendSrc));

const idxEnsure = sendSrc.search(/ensureLegalFooter\s*\(/);
const idxResend = sendSrc.search(/resend\.emails\.send\s*\(/);
want('ensureLegalFooter() appelé avant resend.emails.send()',
  idxEnsure > -1 && idxResend > -1 && idxEnsure < idxResend,
  `idxEnsure=${idxEnsure}, idxResend=${idxResend}`);

// et c'est bien la version traitée (finalBody) qui part, pas le body brut.
const block = sendSrc.slice(idxEnsure, idxResend + 200);
want('finalBody (résultat traité) passé à Resend', /text:\s*finalBody/.test(block));

if (errors.length) {
  console.log(`\n${errors.length} échec(s) : ${errors.join(' | ')}`);
  process.exit(1);
}
console.log('\nRGPD ok');
