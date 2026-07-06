import { requireAuth, setCors, ensureLegalFooter } from './_lib.js';

const DEFAULT_PROMPT = `Tu es un dirigeant parisien qui écrit un email court et naturel à un autre dirigeant pour l'inviter à jouer au padel. Pas un marketeur. Pas un commercial. Un humain qui parle à un humain.

Infos :
- Tu représentes : {{paddleName}}
- Tu écris à : {{name}}, dirigeant de {{company}}{{titleClause}}{{industryClause}}
- Ce que tu proposes : {{offer}}
- Angle d'accroche : {{pitch}}

Si un "Contexte réel sur l'entreprise cible" est fourni plus haut, appuie la phrase 1 dessus. Sinon, reste factuel sur leur secteur ou leur fonction — n'invente jamais leur activité.

Règles strictes :
1. Exactement 3 phrases, courtes.
   - Phrase 1 : une remarque précise et crédible sur LEUR activité ou LEUR secteur. Elle ne parle QUE d'eux — aucune mention du padel ici.
   - Phrase 2 : le pont vers le padel (réseau entre dirigeants, décompresser, souder son équipe). C'est la SEULE phrase où le padel apparaît.
   - Phrase 3 : une seule question concrète pour avancer (proposer un créneau d'essai).
2. Ne mélange jamais leur métier et le padel dans une même phrase.
3. Zéro remplissage. Interdits : "j'espère que vous allez bien", "n'hésitez pas", "cordialement", "à quel point", "passionnant", "univers du", "le monde de".
4. Vouvoiement. Ton direct, concret, humain.
5. Pas de signature, pas de nom à la fin — un bloc signature visuel est ajouté automatiquement côté serveur.

Format EXACT (rien d'autre) :
Objet: {{paddleName}} vous invite à une séance d'essai — vous et votre équipe

[3 phrases]

Aucun commentaire. Aucune explication. Juste l'email.`;

function substitute(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

// Bloc de contexte sur l'entreprise cible, assemblé côté serveur.
// Chaque ligne est omise si la donnée est absente. Renvoie '' si rien.
export function buildCompanyContext({ company, industry, description, keywords } = {}) {
  const lines = [];
  if (industry)    lines.push(`- Secteur : ${industry}`);
  if (description) lines.push(`- Activité : ${description}`);
  if (keywords)    lines.push(`- Mots-clés : ${keywords}`);
  if (!lines.length) return '';
  const who = company ? ` (${company})` : '';
  return `Contexte réel sur l'entreprise cible${who} — sers-t'en pour une accroche précise, n'invente rien au-delà :\n${lines.join('\n')}\n\n`;
}

// Assemble le prompt final. En mode IA, on préfixe le contexte entreprise.
// En mode static, on renvoie le template substitué tel quel : le bloc n'a pas
// de sens dans un mail-type (il apparaîtrait littéralement dans l'envoi).
export function assemblePrompt({ kind, promptTemplate, vars }) {
  const body = substitute(promptTemplate, vars);
  if (kind === 'static') return body;
  return buildCompanyContext(vars) + body;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY manquante dans les variables Vercel' });

  const { prospect, template } = req.body;
  if (!prospect || !template) return res.status(400).json({ error: 'prospect et template requis' });

  const promptTemplate = (template.prompt && template.prompt.trim()) || DEFAULT_PROMPT;

  const vars = {
    paddleName: template.paddleName || '',
    pitch: template.pitch || '',
    offer: template.offer || '',
    name: prospect.name || '',
    company: prospect.company || '',
    title: prospect.title || '',
    industry: prospect.industry || '',
    description: prospect.description || '',
    keywords: prospect.keywords || '',
    titleClause: prospect.title ? ` (${prospect.title})` : '',
    industryClause: prospect.industry ? `, secteur ${prospect.industry}` : '',
  };

  const prompt = assemblePrompt({ kind: template.kind, promptTemplate, vars });

  // Mode "mail-type" : pas d'appel IA, on retourne directement le template
  // substitué. Le footer légal est appliqué comme pour le mode IA.
  if (template.kind === 'static') {
    return res.status(200).json({ mail: ensureLegalFooter(prompt) });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message, detail: data.error });
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: 'Réponse vide de Groq' });

    // On appose le footer légal côté serveur : impossible pour l'utilisateur de
    // le supprimer en éditant son prompt, et l'IA ne peut pas l'oublier.
    // L'envoi (api/send) ré-applique la même logique : double protection.
    const mail = ensureLegalFooter(text);
    return res.status(200).json({ mail });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
