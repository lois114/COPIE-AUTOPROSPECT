// Assemblage du contexte entreprise dans api/generate.js.
// node scripts/company-context-test.mjs

import { buildCompanyContext, assemblePrompt } from '../api/generate.js';

let ko = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) ko++;
};

// buildCompanyContext : une ligne par champ rempli, chaîne vide si rien.
{
  const full = buildCompanyContext({
    company: 'Acme', industry: 'BTP',
    description: 'Construction de maisons', keywords: 'béton, gros œuvre',
  });
  ok(full.includes('Secteur : BTP'), 'tous champs → secteur');
  ok(full.includes('Activité : Construction de maisons'), 'tous champs → activité');
  ok(full.includes('Mots-clés : béton, gros œuvre'), 'tous champs → mots-clés');
  ok(full.includes('Acme'), 'tous champs → nom entreprise');

  const only = buildCompanyContext({ company: 'Acme', industry: 'BTP' });
  ok(only.includes('Secteur : BTP'), 'secteur seul → ligne Secteur');
  ok(!only.includes('Activité'), 'secteur seul → pas de ligne Activité');
  ok(!only.includes('Mots-clés'), 'secteur seul → pas de ligne Mots-clés');

  const empty = buildCompanyContext({ company: 'Acme' });
  ok(empty === '', `aucune donnée → chaîne vide (reçu "${empty}")`);
}

// assemblePrompt : bloc contexte préfixé en mode IA, jamais en mode static.
{
  const vars = { company: 'Acme', industry: 'BTP', description: 'Construction', keywords: 'béton' };
  const tpl = 'Écris à {{company}}.';

  const ai = assemblePrompt({ kind: 'ai', promptTemplate: tpl, vars });
  ok(ai.startsWith('Contexte réel sur l\'entreprise cible'), 'IA → bloc contexte préfixé');
  ok(ai.includes('Écris à Acme.'), 'IA → substitution {{company}}');

  const stat = assemblePrompt({ kind: 'static', promptTemplate: tpl, vars });
  ok(!stat.includes('Contexte réel'), 'static → aucun bloc contexte');
  ok(stat === 'Écris à Acme.', 'static → uniquement le template substitué');
}

if (ko) {
  console.log(`\n${ko} échec(s)`);
  process.exit(1);
}
