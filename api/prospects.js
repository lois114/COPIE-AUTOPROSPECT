import { sql } from './_db.js';
import { requireAuth, setCors } from './_lib.js';

// snake_case (DB) → camelCase (front).
function rowToProspect(r) {
  return {
    id:             r.id,
    name:           r.name,
    company:        r.company,
    title:          r.title,
    email:          r.email,
    city:           r.city,
    arrondissement: r.arrondissement,
    department:     r.department,
    postalCode:     r.postal_code,
    industry:       r.industry,
    description:    r.description,
    keywords:       r.keywords,
    website:        r.website,
    linkedin:       r.linkedin,
    apollo_id:      r.apollo_id,
    status:         r.status,
    mail:           r.mail,
    messageId:      r.message_id,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, company, title, email, city, arrondissement,
               department, postal_code, industry, description, keywords,
               website, linkedin, apollo_id, status, mail, message_id
        FROM prospects
        ORDER BY created_at ASC
      `;
      return res.status(200).json({ prospects: rows.map(rowToProspect) });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const list = Array.isArray(body) ? body : body?.prospects;
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'Body doit être un tableau de prospects' });
      }

      // Normalise les champs (camelCase → snake_case) avant l'INSERT en bloc.
      const payload = JSON.stringify(list.map(p => ({
        id:             String(p.id || ''),
        name:           p.name || '',
        company:        p.company || '',
        title:          p.title || '',
        email:          p.email || '',
        city:           p.city || '',
        arrondissement: p.arrondissement ?? null,
        department:     p.department ?? null,
        postal_code:    p.postalCode ?? null,
        industry:       p.industry || '',
        description:    p.description || '',
        keywords:       p.keywords || '',
        website:        p.website || '',
        linkedin:       p.linkedin || '',
        apollo_id:      p.apollo_id ?? null,
        status:         p.status || 'pending',
        mail:           p.mail || '',
        message_id:     p.messageId ?? null,
      })));

      // Replace-all en une seule transaction.
      // CASCADE supprime aussi les list_prospects ; /api/lists PUT les recrée.
      await sql.transaction([
        sql`TRUNCATE prospects CASCADE`,
        sql`
          INSERT INTO prospects (
            id, name, company, title, email, city, arrondissement,
            department, postal_code, industry, description, keywords, website, linkedin,
            apollo_id, status, mail, message_id
          )
          SELECT id, name, company, title, email, city, arrondissement,
                 department, postal_code, industry, description, keywords, website, linkedin,
                 apollo_id, status, mail, message_id
          FROM jsonb_to_recordset(${payload}::jsonb) AS x(
            id             TEXT,
            name           TEXT,
            company        TEXT,
            title          TEXT,
            email          TEXT,
            city           TEXT,
            arrondissement INT,
            department     TEXT,
            postal_code    TEXT,
            industry       TEXT,
            description    TEXT,
            keywords       TEXT,
            website        TEXT,
            linkedin       TEXT,
            apollo_id      TEXT,
            status         TEXT,
            mail           TEXT,
            message_id     TEXT
          )
          ON CONFLICT (id) DO NOTHING
        `,
      ]);

      return res.status(200).json({ ok: true, count: list.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('prospects error:', err);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
