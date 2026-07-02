#!/usr/bin/env node
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);
process.env.STRAPI_DISABLE_UPLOAD_PROVIDER ??= 'true';
process.env.STRAPI_SKIP_BOOTSTRAP_PERMISSIONS ??= 'true';

const navigationData = {
  brandLabel: 'SUBCO PRETE',
  supportLabelFr: 'Support / Contact',
  supportLabelRn: 'Ubufasha / Twandikire',
  supportUrl: '/candidature',
  primaryItems: [
    { labelFr: 'Accueil', labelRn: 'Intango', url: '/', sortOrder: 1, isVisible: true },
    { labelFr: 'À propos', labelRn: 'Ibijanye', url: '/a-propos', sortOrder: 2, isVisible: true },
    { labelFr: 'Chaînes de valeur', labelRn: 'Imirongo y’agaciro', url: '/chaines-valeur', sortOrder: 3, isVisible: true },
    { labelFr: 'Appels', labelRn: 'Amasoko', url: '/appels', sortOrder: 4, isVisible: true },
    { labelFr: 'Ressources', labelRn: 'Inyandiko', url: '/ressources', sortOrder: 5, isVisible: true },
    { labelFr: 'Candidature', labelRn: 'Gusaba', url: '/candidature', sortOrder: 6, isVisible: true },
  ],
  newsLabelFr: 'Actualités',
  newsLabelRn: 'Amakuru',
  newsItems: [
    { labelFr: 'Actualités', labelRn: 'Amakuru', url: '/actualites', sortOrder: 1, isVisible: true },
    { labelFr: 'Événements', labelRn: 'Ibikorwa', url: '/evenements', sortOrder: 2, isVisible: true },
    { labelFr: 'Communiqués', labelRn: 'Amatangazo', url: '/actualites?categorie=communiques', sortOrder: 3, isVisible: true },
    { labelFr: 'Annonces / résultats', labelRn: 'Ibisohoka', url: '/actualites?categorie=annonces-resultats', sortOrder: 4, isVisible: true },
  ],
  ctaLabelFr: 'Candidater',
  ctaLabelRn: 'Gusaba',
  ctaUrl: '/candidature/deposer',
};

async function main() {
  const appContext = await compileStrapi({ cwd: projectRoot });
  const app = await createStrapi(appContext).load();
  const uid = 'api::site-navigation.site-navigation';

  try {
    const existing = await app.documents(uid).findFirst({ status: 'draft' });

    if (existing?.documentId) {
      await app.documents(uid).update({
        documentId: existing.documentId,
        data: navigationData,
      });
      await app.documents(uid).publish({ documentId: existing.documentId });
      console.log(`Site navigation mise à jour: ${existing.documentId}`);
    } else {
      const created = await app.documents(uid).create({
        data: navigationData,
      });
      await app.documents(uid).publish({ documentId: created.documentId });
      console.log(`Site navigation créée: ${created.documentId}`);
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
