#!/usr/bin/env node
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);

const stepsData = [
  { cohorte: 'cohorte-1', ordre: 1, titre: 'Publication AMI', date_affichee: 'Mai 2026', statut: 'termine' },
  { cohorte: 'cohorte-1', ordre: 2, titre: "Ateliers d'information régionaux", date_affichee: 'Mai–Juin 2026', statut: 'termine' },
  { cohorte: 'cohorte-1', ordre: 3, titre: 'Clôture des candidatures', date_affichee: '15 juin 2026', statut: 'termine' },
  { cohorte: 'cohorte-1', ordre: 4, titre: 'Instruction des dossiers', date_affichee: 'Juil. 2026', statut: 'en-cours' },
  { cohorte: 'cohorte-1', ordre: 5, titre: 'Comité de sélection', date_affichee: 'Août 2026', statut: 'a-venir' },
  { cohorte: 'cohorte-1', ordre: 6, titre: 'Publication des résultats', date_affichee: 'Août 2026', statut: 'a-venir', lien_url: '/actualites', lien_label: 'Voir les résultats' },
  { cohorte: 'cohorte-1', ordre: 7, titre: 'Contractualisation', date_affichee: 'Sept. 2026', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 1, titre: 'Préparation AMI', date_affichee: 'Oct. 2026', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 2, titre: 'Publication AMI', date_affichee: 'Nov. 2026', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 3, titre: 'Ateliers régionaux', date_affichee: 'Nov.–Déc. 2026', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 4, titre: 'Clôture des candidatures', date_affichee: 'Jan. 2027', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 5, titre: 'Instruction', date_affichee: 'Fév. 2027', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 6, titre: 'Comité de sélection', date_affichee: 'Mars 2027', statut: 'a-venir' },
  { cohorte: 'cohorte-2', ordre: 7, titre: 'Publication des résultats', date_affichee: 'Avr. 2027', statut: 'a-venir' },
];

async function main() {
  const appContext = await compileStrapi({ cwd: projectRoot });
  const app = await createStrapi(appContext).load();
  const uid = 'api::etape-programme.etape-programme';

  try {
    for (const item of stepsData) {
      const existing = await app.documents(uid).findFirst({
        status: 'draft',
        filters: {
          cohorte: { $eq: item.cohorte },
          ordre: { $eq: item.ordre },
        },
      });

      if (existing?.documentId) {
        await app.documents(uid).update({
          documentId: existing.documentId,
          data: item,
        });
        await app.documents(uid).publish({ documentId: existing.documentId });
        console.log(`Étape mise à jour: ${item.cohorte}#${item.ordre}`);
      } else {
        const created = await app.documents(uid).create({ data: item });
        await app.documents(uid).publish({ documentId: created.documentId });
        console.log(`Étape créée: ${item.cohorte}#${item.ordre}`);
      }
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
