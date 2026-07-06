import { setCors } from './_lib.js';

// Comparaison constante (anti timing attack)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return res.status(500).json({ error: 'SITE_PASSWORD non configuré dans Vercel' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  if (safeEqual(String(password), sitePassword)) {
    return res.status(200).json({ success: true });
  } else {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
}
