#!/usr/bin/env node
const path = require('path');
const { Client } = require('pg');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);

const stepsData = [
  {
    documentId: 'etape-cohorte-1-1',
    cohorte: 'cohorte-1',
    ordre: 1,
    titre: 'Publication AMI',
    date_affichee: 'Mai 2026',
    statut: 'termine',
  },
  {
    documentId: 'etape-cohorte-1-2',
    cohorte: 'cohorte-1',
    ordre: 2,
    titre: "Ateliers d'information régionaux",
    date_affichee: 'Mai–Juin 2026',
    statut: 'termine',
  },
  {
    documentId: 'etape-cohorte-1-3',
    cohorte: 'cohorte-1',
    ordre: 3,
    titre: 'Clôture des candidatures',
    date_affichee: '15 juin 2026',
    statut: 'termine',
  },
  {
    documentId: 'etape-cohorte-1-4',
    cohorte: 'cohorte-1',
    ordre: 4,
    titre: 'Instruction des dossiers',
    date_affichee: 'Juil. 2026',
    statut: 'en-cours',
  },
  {
    documentId: 'etape-cohorte-1-5',
    cohorte: 'cohorte-1',
    ordre: 5,
    titre: 'Comité de sélection',
    date_affichee: 'Août 2026',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-1-6',
    cohorte: 'cohorte-1',
    ordre: 6,
    titre: 'Publication des résultats',
    date_affichee: 'Août 2026',
    statut: 'a-venir',
    lien_url: '/actualites',
    lien_label: 'Voir les résultats',
  },
  {
    documentId: 'etape-cohorte-1-7',
    cohorte: 'cohorte-1',
    ordre: 7,
    titre: 'Contractualisation',
    date_affichee: 'Sept. 2026',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-1',
    cohorte: 'cohorte-2',
    ordre: 1,
    titre: 'Préparation AMI',
    date_affichee: 'Oct. 2026',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-2',
    cohorte: 'cohorte-2',
    ordre: 2,
    titre: 'Publication AMI',
    date_affichee: 'Nov. 2026',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-3',
    cohorte: 'cohorte-2',
    ordre: 3,
    titre: 'Ateliers régionaux',
    date_affichee: 'Nov.–Déc. 2026',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-4',
    cohorte: 'cohorte-2',
    ordre: 4,
    titre: 'Clôture des candidatures',
    date_affichee: 'Jan. 2027',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-5',
    cohorte: 'cohorte-2',
    ordre: 5,
    titre: 'Instruction',
    date_affichee: 'Fév. 2027',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-6',
    cohorte: 'cohorte-2',
    ordre: 6,
    titre: 'Comité de sélection',
    date_affichee: 'Mars 2027',
    statut: 'a-venir',
  },
  {
    documentId: 'etape-cohorte-2-7',
    cohorte: 'cohorte-2',
    ordre: 7,
    titre: 'Publication des résultats',
    date_affichee: 'Avr. 2027',
    statut: 'a-venir',
  },
];

function getPgConfig() {
  if (process.env.DATABASE_CLIENT && process.env.DATABASE_CLIENT !== 'postgres') {
    throw new Error(`populate-program-steps supports only postgres, got ${process.env.DATABASE_CLIENT}`);
  }

  return {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || 'strapi',
    user: process.env.DATABASE_USERNAME || 'strapi',
    password: process.env.DATABASE_PASSWORD || 'strapi',
    ssl: process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
        }
      : false,
  };
}

function buildInsertParams(rows) {
  const values = [];
  const placeholders = rows
    .map((row, index) => {
      const offset = index * 9;
      values.push(
        row.documentId,
        row.titre,
        row.description ?? null,
        row.cohorte,
        row.statut,
        row.date_affichee,
        row.lien_url ?? null,
        row.lien_label ?? null,
        row.ordre
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
    })
    .join(',\n');

  return { values, placeholders };
}

async function main() {
  const client = new Client(getPgConfig());
  await client.connect();

  const draftRows = stepsData.map((step) => ({ ...step }));
  const publishedRows = stepsData.map((step) => ({ ...step }));
  const draft = buildInsertParams(draftRows);
  const published = buildInsertParams(publishedRows);

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM etape_programmes');

    await client.query(
      `
        INSERT INTO etape_programmes (
          document_id,
          titre,
          description,
          cohorte,
          statut,
          date_affichee,
          lien_url,
          lien_label,
          ordre,
          created_at,
          updated_at,
          published_at,
          locale
        )
        SELECT
          payload.document_id,
          payload.titre,
          payload.description,
          payload.cohorte,
          payload.statut,
          payload.date_affichee,
          payload.lien_url,
          payload.lien_label,
          payload.ordre::integer,
          NOW(),
          NOW(),
          NULL,
          NULL
        FROM (
          VALUES
          ${draft.placeholders}
        ) AS payload(
          document_id,
          titre,
          description,
          cohorte,
          statut,
          date_affichee,
          lien_url,
          lien_label,
          ordre
        )
      `,
      draft.values
    );

    await client.query(
      `
        INSERT INTO etape_programmes (
          document_id,
          titre,
          description,
          cohorte,
          statut,
          date_affichee,
          lien_url,
          lien_label,
          ordre,
          created_at,
          updated_at,
          published_at,
          locale
        )
        SELECT
          payload.document_id,
          payload.titre,
          payload.description,
          payload.cohorte,
          payload.statut,
          payload.date_affichee,
          payload.lien_url,
          payload.lien_label,
          payload.ordre::integer,
          NOW(),
          NOW(),
          NOW(),
          NULL
        FROM (
          VALUES
          ${published.placeholders}
        ) AS payload(
          document_id,
          titre,
          description,
          cohorte,
          statut,
          date_affichee,
          lien_url,
          lien_label,
          ordre
        )
      `,
      published.values
    );

    const result = await client.query(`
      SELECT cohorte, ordre, titre, statut
      FROM etape_programmes
      WHERE published_at IS NOT NULL
      ORDER BY cohorte, ordre
    `);

    await client.query('COMMIT');

    for (const row of result.rows) {
      console.log(`Étape publiée: ${row.cohorte}#${row.ordre} ${row.titre} (${row.statut})`);
    }

    console.log(`Total publié: ${result.rowCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
