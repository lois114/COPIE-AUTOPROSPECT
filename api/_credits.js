// Compteur de crédits Apollo. Partagé entre /api/credits (lecture) et
// /api/search (écriture + blocage mensuel).
// 1 crédit = 1 prospect enrichi avec un email non vide.

export const DAY_LIMIT = 50;
export const MONTH_LIMIT = 1500;

// Renvoie { today, month } pour la date UTC courante.
export async function getUsage(sql) {
  const rows = await sql`
    SELECT
      COALESCE(SUM(credits) FILTER (WHERE day = CURRENT_DATE), 0)::int AS today,
      COALESCE(SUM(credits) FILTER (WHERE date_trunc('month', day) = date_trunc('month', CURRENT_DATE)), 0)::int AS month
    FROM apollo_usage
  `;
  return rows[0] || { today: 0, month: 0 };
}

// Incrémente le compteur du jour (UPSERT).
export async function addUsage(sql, credits) {
  if (!credits || credits <= 0) return;
  await sql`
    INSERT INTO apollo_usage (day, credits)
    VALUES (CURRENT_DATE, ${credits})
    ON CONFLICT (day) DO UPDATE
      SET credits = apollo_usage.credits + EXCLUDED.credits,
          updated_at = NOW()
  `;
}
