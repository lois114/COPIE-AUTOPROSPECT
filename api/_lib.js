// Helpers communs aux endpoints API.
// - requireAuth : vérifie le header Authorization: Bearer <SITE_PASSWORD>
// - setCors     : autorise uniquement le same-origin (pas de wildcard *)

// Compare deux strings en temps constant pour éviter les timing attacks.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireAuth(req) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return { ok: false, status: 500, error: 'SITE_PASSWORD non configuré dans Vercel' };
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(token, expected)) {
    return { ok: false, status: 401, error: 'Non authentifié' };
  }
  return { ok: true };
}

// Pas de CORS wildcard. Le front et l'API sont sur le même domaine Vercel,
// donc les requêtes same-origin ne déclenchent même pas de preflight.
// Pour OPTIONS éventuels, on renvoie juste les méthodes/headers autorisés
// sans Allow-Origin → le navigateur bloquera tout cross-origin malveillant.
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Mention légale ajoutée à chaque mail (RGPD art. 14 + 21 + L34-5 CPCE).
// Surchargeable via LEGAL_FOOTER côté Vercel si le client veut une autre formulation.
const DEFAULT_LEGAL_FOOTER = `

—
Vos coordonnées professionnelles ont été obtenues via Apollo.io. Pour ne plus recevoir ce type d'emails, répondez "STOP" — votre demande sera prise en compte immédiatement.`;

export function getLegalFooter() {
  return process.env.LEGAL_FOOTER || DEFAULT_LEGAL_FOOTER;
}

// Vrai si le texte contient déjà notre formulation d'opt-out (heuristique
// volontairement large pour gérer les variations de ponctuation/casse).
export function hasLegalFooter(text) {
  if (!text) return false;
  const s = String(text).toLowerCase();
  return s.includes('répondez "stop"')
      || s.includes('répondez stop')
      || s.includes('repondez "stop"')
      || s.includes('repondez stop');
}

// Garantit qu'un mail sortant comporte le footer légal. Si l'utilisateur l'a
// supprimé en éditant le mail, on le ré-appose (transparent, sans erreur).
export function ensureLegalFooter(text) {
  const t = String(text || '');
  if (hasLegalFooter(t)) return t;
  return t.trimEnd() + getLegalFooter();
}

// Version HTML pour les mails envoyés en HTML
// Le body (plain text) est converti en HTML safe, puis on lui colle la
// signature (si configurée) et le footer légal HTML, dans cet ordre :
//   1. corps du mail
//   2. SIGNATURE_HTML (coordonnées + logo de l'utilisateur)
//   3. footer légal RGPD

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain text → HTML : escape + paragraphes (double \n) + <br> (simple \n).
export function bodyToHtml(text) {
  const escaped = escapeHtml(text);
  return escaped
    .split(/\n\s*\n/)
    .map(p => `<p style="margin:0 0 12px 0">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const DEFAULT_LEGAL_FOOTER_HTML = `
<p style="margin:24px 0 0 0;color:#666;font-size:12px;line-height:1.5;border-top:1px solid #ddd;padding-top:12px">
  Vos coordonnées professionnelles ont été obtenues via Apollo.io. Pour ne plus recevoir ce type d'emails, répondez "STOP" — votre demande sera prise en compte immédiatement.
</p>`;

export function getLegalFooterHtml() {
  return process.env.LEGAL_FOOTER_HTML || DEFAULT_LEGAL_FOOTER_HTML;
}

export function getSignatureHtml() {
  return process.env.SIGNATURE_HTML || '';
}

// Construit le mail HTML complet à partir du body plain text.
export function buildHtmlEmail(body) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;max-width:600px;margin:0;padding:0">
${bodyToHtml(body)}
${getSignatureHtml()}
${getLegalFooterHtml()}
</body>
</html>`;
}
