import { sql } from './_db.js';
import { requireAuth, setCors } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    if (req.method === 'GET') {
      // Agrège les prospect_ids par liste, en garantissant un array vide
      // si la liste est vide (pas de NULL).
      const rows = await sql`
        SELECT l.id, l.name,
               COALESCE(
                 array_agg(lp.prospect_id) FILTER (WHERE lp.prospect_id IS NOT NULL),
                 ARRAY[]::TEXT[]
               ) AS prospect_ids
        FROM lists l
        LEFT JOIN list_prospects lp ON lp.list_id = l.id
        GROUP BY l.id, l.name, l.created_at
        ORDER BY l.created_at ASC
      `;
      const lists = rows.map(r => ({
        id: r.id,
        name: r.name,
        prospectIds: r.prospect_ids || [],
      }));
      return res.status(200).json({ lists });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const lists = Array.isArray(body) ? body : body?.lists;
      if (!Array.isArray(lists)) {
        return res.status(400).json({ error: 'Body doit être un tableau de listes' });
      }

      // Sépare les listes et leurs liens (table de jointure).
      const listRows = lists
        .filter(l => l?.id && l?.name)
        .map(l => ({ id: String(l.id), name: String(l.name) }));
      const pairRows = [];
      for (const l of lists) {
        if (!l?.id) continue;
        for (const pid of (l.prospectIds || [])) {
          if (pid) pairRows.push({ list_id: String(l.id), prospect_id: String(pid) });
        }
      }
      const listsPayload = JSON.stringify(listRows);
      const pairsPayload = JSON.stringify(pairRows);

      // Replace-all transactionnel. Le INNER JOIN sur prospects filtre
      // automatiquement les prospect_ids qui n'existeraient pas encore
      // (évite les violations de FK si /api/prospects n'a pas fini).
      await sql.transaction([
        sql`TRUNCATE lists CASCADE`,
        sql`
          INSERT INTO lists (id, name)
          SELECT id, name
          FROM jsonb_to_recordset(${listsPayload}::jsonb) AS x(id TEXT, name TEXT)
        `,
        sql`
          INSERT INTO list_prospects (list_id, prospect_id)
          SELECT j.list_id, j.prospect_id
          FROM jsonb_to_recordset(${pairsPayload}::jsonb) AS j(list_id TEXT, prospect_id TEXT)
          INNER JOIN prospects p ON p.id = j.prospect_id
        `,
      ]);

      return res.status(200).json({ ok: true, count: listRows.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('lists error:', err);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
