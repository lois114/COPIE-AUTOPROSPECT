// Récupère le statut tracking de mails envoyés via Resend.
// Body: { messageIds: ["id1", "id2", ...] }
// Réponse: { statuses: { id1: { last_event: "opened", ... }, ... } }

import { requireAuth, setCors } from './_lib.js';

// Throttle : 10 requêtes en parallèle max, 200ms de pause entre les batches.
// Avant : Promise.all sur N ids → des centaines d'appels simultanés à Resend,
// 429 garantis à partir d'~30 prospects. Maintenant : 100 ids = ~2s, sans 429.
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

async function fetchOneStatus(id, apiKey) {
  try {
    const resp = await fetch(`https://api.resend.com/emails/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return { id, value: { error: `HTTP ${resp.status}` } };
    const data = await resp.json();
    return {
      id,
      value: {
        last_event: data.last_event || null,
        created_at: data.created_at || null,
        to: data.to || null,
        subject: data.subject || null,
      },
    };
  } catch (e) {
    return { id, value: { error: e.message } };
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY manquante.' });

  const { messageIds } = req.body || {};
  const ids = Array.isArray(messageIds) ? messageIds.filter(Boolean) : [];
  if (!ids.length) return res.json({ statuses: {} });

  const statuses = {};
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(id => fetchOneStatus(id, apiKey)));
    for (const { id, value } of results) statuses[id] = value;
    // Pause entre batches uniquement s'il reste du travail
    if (i + BATCH_SIZE < ids.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return res.json({ statuses });
}
