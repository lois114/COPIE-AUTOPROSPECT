import { sql } from './_db.js';
import { requireAuth, setCors } from './_lib.js';
import { DAY_LIMIT, MONTH_LIMIT, getUsage } from './_credits.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const { today, month } = await getUsage(sql);
    return res.status(200).json({
      today,
      month,
      dayLimit: DAY_LIMIT,
      monthLimit: MONTH_LIMIT,
    });
  } catch (err) {
    console.error('credits error:', err);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
