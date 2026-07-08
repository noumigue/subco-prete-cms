#!/usr/bin/env node
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);
process.env.STRAPI_DISABLE_UPLOAD_PROVIDER ??= 'true';
process.env.STRAPI_SKIP_BOOTSTRAP_PERMISSIONS ??= 'true';

// Footer « parcours + redevabilité » : 3 colonnes (programme / candidater / aide)
// + groupe legal (barre du bas). Voir layout.tsx pour le rendu.
const footerLinks = [
  // Colonne « Le programme »
  { group: 'programme', label: 'Le mécanisme', url: '/#home-mechanism-band', sortOrder: 1 },
  { group: 'programme', label: 'Chaînes de valeur', url: '/chaines-valeur', sortOrder: 2 },
  { group: 'programme', label: 'Exemples d’infrastructures', url: '/#home-infrastructure-band', sortOrder: 3 },
  { group: 'programme', label: 'Actualités & événements', url: '/actualites', sortOrder: 4 },
  { group: 'programme', label: 'À propos de l’UGP PRETE', url: 'https://prete.bi/mission/', sortOrder: 5 },
  // Colonne « Candidater »
  { group: 'candidater', label: 'Vérifier mon éligibilité', url: '/eligibilite', sortOrder: 1 },
  { group: 'candidater', label: 'Appels à propositions', url: '/appels', sortOrder: 2 },
  { group: 'candidater', label: 'Déposer une candidature', url: '/candidature', sortOrder: 3 },
  { group: 'candidater', label: 'Documents & ressources', url: '/ressources', sortOrder: 4 },
  { group: 'candidater', label: 'Espace opérateur', url: '/connexion', sortOrder: 5 },
  // Colonne « Aide & recours »
  { group: 'aide', label: 'FAQ', url: '/faq', sortOrder: 1 },
  { group: 'aide', label: 'Contact & support', url: '/contact', sortOrder: 2 },
  { group: 'aide', label: 'Réclamations & recours', url: '/reclamations', sortOrder: 3 },
  // Barre du bas (legal)
  { group: 'legal', label: 'Mentions légales', url: '/mentions-legales', sortOrder: 1 },
  { group: 'legal', label: 'Confidentialité des données', url: '/confidentialite', sortOrder: 2 },
  { group: 'legal', label: 'Accessibilité', url: '/accessibilite', sortOrder: 3 },
];

async function main() {
  const appContext = await compileStrapi({ cwd: projectRoot });
  const app = await createStrapi(appContext).load();
  const uid = 'api::footer-link.footer-link';

  try {
    const existing = await app.documents(uid).findMany({
      status: 'draft',
      pagination: { pageSize: 200 },
    });

    for (const item of existing) {
      if (item?.documentId) {
        await app.documents(uid).delete({ documentId: item.documentId });
      }
    }
    console.log(`Anciens liens supprimés: ${existing.length}`);

    for (const item of footerLinks) {
      const created = await app.documents(uid).create({
        data: { ...item, isVisible: true },
      });
      await app.documents(uid).publish({ documentId: created.documentId });
      console.log(`footer-link créé: ${item.group} · ${item.label}`);
    }

    console.log(`\nTerminé : ${footerLinks.length} liens créés.`);
  } finally {
    await app.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
