'use strict';

// M7 L3-bis — integrite du journal des actes JUSQU'A LA BASE (§14.10).
// Un trigger PostgreSQL leve une exception sur tout UPDATE ou DELETE de la table
// `actes_dossier` : l'append-only devient vrai pour TOUS les chemins d'ecriture,
// y compris le Content Manager Strapi et le super admin (le blocage API ne suffit pas).
// Seule voie de mutation restante : suppression du trigger en acces base direct
// (discipline infra, documentee dans le README technique).
//
// Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). Postgres uniquement :
// en dev SQLite, le trigger est ignore (le blocage API et la doctrine restent en place).
// Verifie : aucun lifecycle existant n'update `acte-dossier` (journal ecrit en create-only).

const JOURNAL_TABLE = 'actes_dossier';

module.exports = {
  async up(knex) {
    const client = knex.client?.config?.client || '';
    if (!/pg|postgres/i.test(client)) {
      // eslint-disable-next-line no-console
      console.info(`[migration] journal-append-only ignore (client=${client}, non-postgres).`);
      return;
    }

    await knex.raw(`
      CREATE OR REPLACE FUNCTION refuse_journal_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Journal des actes : append-only (aucune modification ni suppression autorisee).';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await knex.raw(`DROP TRIGGER IF EXISTS journal_append_only ON ${JOURNAL_TABLE};`);
    await knex.raw(`
      CREATE TRIGGER journal_append_only
      BEFORE UPDATE OR DELETE ON ${JOURNAL_TABLE}
      FOR EACH ROW EXECUTE FUNCTION refuse_journal_mutation();
    `);
  },

  async down(knex) {
    const client = knex.client?.config?.client || '';
    if (!/pg|postgres/i.test(client)) return;
    await knex.raw(`DROP TRIGGER IF EXISTS journal_append_only ON ${JOURNAL_TABLE};`);
    await knex.raw('DROP FUNCTION IF EXISTS refuse_journal_mutation();');
  },
};
