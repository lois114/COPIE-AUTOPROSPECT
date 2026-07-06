import { neon } from '@neondatabase/serverless';

// Driver HTTP de Neon — pas de pool à gérer, idéal pour les Functions Vercel.
// L'intégration Neon (Marketplace) peut nommer la connection string :
//  - DATABASE_URL (cas standard, sans préfixe)
//  - <PREFIX>_DATABASE_URL (si custom prefix défini lors de l'install)
//  - POSTGRES_URL / <PREFIX>_POSTGRES_URL (templates Vercel Postgres legacy)
// On accepte n'importe lequel pour ne pas dépendre du choix de prefix.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.STORAGE_PME_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.STORAGE_PME_POSTGRES_URL;

if (!connectionString) {
  // Lance à l'import pour échouer fort, pas au premier query.
  throw new Error(
    'Aucune connection string Postgres trouvée. Vérifie que l\'intégration Neon est bien liée au projet Vercel (env var DATABASE_URL ou STORAGE_PME_DATABASE_URL).'
  );
}

export const sql = neon(connectionString);
