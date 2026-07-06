import { requireAuth, setCors } from './_lib.js';
import { sql } from './_db.js';
import { DAY_LIMIT, MONTH_LIMIT, getUsage, addUsage } from './_credits.js';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

// Mapping régions FR → locations Apollo (langage naturel)
const REGION_LOCATIONS = {
  'FR-IDF': ['île-de-france, france'],
  'FR-ARA': ['auvergne-rhône-alpes, france'],
  'FR-PAC': ["provence-alpes-côte d'azur, france"],
  'FR-NAQ': ['nouvelle-aquitaine, france'],
  'FR-OCC': ['occitanie, france'],
  'FR-PDL': ['pays de la loire, france'],
  'FR-HDF': ['hauts-de-france, france'],
  'FR-GES': ['grand est, france'],
  'FR-BRE': ['bretagne, france'],
  'FR-NOR': ['normandie, france'],
  'FR-CVL': ['centre-val de loire, france'],
  'FR-BFC': ['bourgogne-franche-comté, france'],
  'FR-COR': ['corse, france'],
};

// Construit les locations Apollo à partir d'une liste d'arrondissements parisiens
function buildParisLocations(arrondissements) {
  if (!Array.isArray(arrondissements) || !arrondissements.length) {
    return ['Paris, France'];
  }
  // Si tous les arrondissements sont sélectionnés, on élargit à "Paris, France"
  // pour bénéficier des fiches sans arrondissement renseigné.
  if (arrondissements.length === 20) return ['Paris, France'];

  const locations = [];
  for (const n of arrondissements) {
    const suffix = n === 1 ? '1er' : `${n}e`;
    locations.push(`Paris ${suffix} Arrondissement, France`);
  }
  return locations;
}

// Construit les locations Apollo selon le mode de zone choisi
function buildLocations({ zoneMode, arrondissements, regions }) {
  if (zoneMode === 'france') {
    return ['france'];
  }
  if (zoneMode === 'regions') {
    const codes = Array.isArray(regions) ? regions : [];
    const locs = codes.flatMap(c => REGION_LOCATIONS[c] || []);
    return locs.length ? locs : ['france'];
  }
  return buildParisLocations(arrondissements);
}

// Codes postaux des arrondissements (75001 → 1, 75020 → 20)
function arrFromPostalCode(addr) {
  const m = String(addr || '').match(/\b750(0[1-9]|1[0-9]|20)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// Extrait un code postal FR (5 chiffres, premier non-nul)
function extractPostalCode(addr) {
  const m = String(addr || '').match(/\b(0[1-9]|[1-9][0-9])\d{3}\b/);
  return m ? m[0] : null;
}

// Code département FR depuis le code postal (Corse + DOM gérés)
function deptFromPostal(postal) {
  if (!postal) return null;
  if (postal.startsWith('200') || postal.startsWith('201')) return '2A';
  if (postal.startsWith('202') || postal.startsWith('206')) return '2B';
  if (postal.startsWith('97') || postal.startsWith('98')) return postal.slice(0, 3);
  return postal.slice(0, 2);
}

// Mapping taille entreprise → format Apollo "min,max"
function toApolloSizes(headcount) {
  return headcount.map(h => h.replace('-', ','));
}

// Tronque proprement une chaîne à `max` caractères (+ ellipse).
function clampText(s, max) {
  const t = String(s || '').trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APOLLO_API_KEY manquante dans les variables Vercel' });

  const { action, payload } = req.body;

  try {
    if (action === 'fetch') {
      // ── Garde-fou crédits Apollo ────────────────────────────────────────
      // Quota mensuel dur : on bloque toute nouvelle recherche au-delà.
      // Quota journalier purement indicatif côté UI → pas de blocage ici.
      // Valeurs configurées dans api/_credits.js (DAY_LIMIT / MONTH_LIMIT).
      const usage = await getUsage(sql);
      if (usage.month >= MONTH_LIMIT) {
        return res.status(429).json({
          error: `Quota Apollo mensuel atteint (${usage.month}/${MONTH_LIMIT}). Réessaie le mois prochain ou augmente la limite.`,
          usage: { ...usage, dayLimit: DAY_LIMIT, monthLimit: MONTH_LIMIT },
        });
      }

      // headcount: [] (ou absent) = "toute taille" → on n'envoie pas le filtre Apollo
      const sizeRaw = payload.headcount;
      const headcount = Array.isArray(sizeRaw) ? sizeRaw.filter(Boolean) : (sizeRaw ? sizeRaw.split(',').filter(Boolean) : []);
      const requestedLimit = payload.limit || 10;
      // Cap implicite : on n'enrichit jamais au-delà du crédit mensuel restant.
      const limit = Math.min(requestedLimit, MONTH_LIMIT - usage.month);

      const arrondissements = Array.isArray(payload.arrondissements) ? payload.arrondissements : [];
      const regions = Array.isArray(payload.regions) ? payload.regions : [];
      const zoneMode = payload.zoneMode || 'paris';
      const locations = buildLocations({ zoneMode, arrondissements, regions });
      const arrSet = new Set(arrondissements);

      const excludeIds = new Set(
        Array.isArray(payload.excludeIds) ? payload.excludeIds.filter(Boolean) : []
      );

      // Variantes de mots-clés : `industries: string[]` (nouveau) ou `industry: string` (legacy).
      // Tableau vide = pas de filtre sectoriel (mais on fait quand même un passage).
      const industries = Array.isArray(payload.industries) && payload.industries.length
        ? payload.industries
        : (payload.industry ? [payload.industry] : ['']);

      // ── Boucle multi-variantes : pour chaque mot-clé, on parcourt les pages
      // jusqu'à avoir `limit` prospects vraiment nouveaux. On passe à la variante
      // suivante quand la précédente est épuisée — la dédup par `id` empêche
      // de re-traiter un prospect croisé sur deux requêtes.
      const MAX_PAGES = 10;
      const PER_PAGE = Math.max(limit, 10); // au moins 10/page pour pas multiplier les calls
      const newPeople = [];
      let totalEntries = 0;

      variantLoop:
      for (const variant of industries) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const searchBody = {
            per_page: PER_PAGE,
            page,
            person_locations: locations,
            person_seniorities: ['owner', 'founder', 'c_suite', 'partner', 'director'],
            contact_email_status: ['verified', 'likely to engage'],
          };
          if (headcount.length) searchBody.organization_num_employees_ranges = toApolloSizes(headcount);
          if (variant) searchBody.q_keywords = variant;

          console.log(`→ Apollo search [${variant || '∅'}] page ${page}:`, JSON.stringify(searchBody));

          const searchResp = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
            body: JSON.stringify(searchBody),
          });
          const searchData = await searchResp.json();
          if (!searchResp.ok) {
            console.error('← Apollo error:', searchResp.status, JSON.stringify(searchData));
            return res.status(searchResp.status).json({ error: searchData.message || 'Erreur Apollo', detail: searchData });
          }

          const people = searchData.people || searchData.contacts || [];
          totalEntries = searchData.pagination?.total_entries || totalEntries;
          console.log(`← [${variant || '∅'}] page ${page}: ${people.length} reçus, total catalogue=${totalEntries}`);

          for (const p of people) {
            if (p.id && !excludeIds.has(p.id)) {
              newPeople.push(p);
              excludeIds.add(p.id); // dédup intra-réponse ET inter-variantes
              if (newPeople.length >= limit) break variantLoop;
            }
          }

          if (people.length < PER_PAGE) break; // plus de pages pour cette variante
        }
      }

      console.log(`→ ${newPeople.length} nouveaux prospects à enrichir (${industries.length} variante${industries.length > 1 ? 's' : ''})`);

      // ── Enrich chaque prospect non vu (1 crédit/prospect) ─────────────────
      const prospects = await Promise.all(newPeople.map(async (p) => {
        let full = null;
        if (p.id) {
          try {
            const enrichResp = await fetch(`${APOLLO_BASE}/people/match`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
              body: JSON.stringify({ id: p.id, reveal_personal_emails: false }),
            });
            const enrichData = await enrichResp.json();
            full = enrichData.person || null;
          } catch (e) {
            console.log('Enrich error:', e.message);
          }
        }

        const src = full || p;
        const org = src.organization || full?.organization || p.organization || {};

        const rawAddress = src.present_raw_address || org.raw_address || '';
        const combined = [rawAddress, src.city, org.city, org.postal_code, org.raw_address].filter(Boolean).join(' ');
        const arr = arrFromPostalCode(combined);
        const postalCode = org.postal_code || extractPostalCode(combined);
        const department = deptFromPostal(postalCode);

        // Contexte entreprise depuis l'enrich Apollo (noms de champs défensifs).
        const description = clampText(org.short_description || org.seo_description || '', 300);
        const keywords = Array.isArray(org.keywords) ? org.keywords.slice(0, 8).join(', ') : '';

        return {
          name: [src.first_name, src.last_name].filter(Boolean).join(' ') || 'Inconnu',
          company: org.name || src.organization_name || p.organization?.name || '—',
          title: src.title || p.title || '',
          email: src.email || '',
          city: src.city || org.city || rawAddress || '',
          arrondissement: arr,
          postalCode,
          department,
          website: org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : ''),
          linkedin: org.linkedin_url || '',
          industry: org.industry || '',
          description,
          keywords,
          apollo_id: src.id || p.id || null,
        };
      }));

      // Filtre arrondissement côté serveur (sécurité) — seulement en mode Paris
      const filtered = zoneMode === 'paris' && arrSet.size && arrSet.size < 20
        ? prospects.filter(p => p.arrondissement == null || arrSet.has(p.arrondissement))
        : prospects;

      // Comptabilise les crédits Apollo réellement consommés (1 par email révélé).
      // On compte sur `prospects` avant le filtre arrondissement : Apollo a déjà
      // facturé l'enrich même si on jette la fiche pour cause de mauvais arrt.
      const creditsUsed = prospects.filter(p => p.email).length;
      await addUsage(sql, creditsUsed);
      const after = await getUsage(sql);

      return res.status(200).json({
        prospects: filtered,
        total: totalEntries || filtered.length,
        usage: { ...after, dayLimit: DAY_LIMIT, monthLimit: MONTH_LIMIT },
      });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
