#!/usr/bin/env node
/*
 * Maintenance one-off — MGP (K5) en local :
 *  1. purge l'ancienne entree MGP mal placee dans `faq-entree` (collection orpheline)
 *  2. garantit l'entree MGP dans `faq-item` (celle lue par la page operateur), publiee
 *
 * Idempotent. Cible la base pointee par le .env local (cf. strapi-env).
 * Usage : node scripts/fix-mgp-faq.js
 */
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);
process.env.STRAPI_DISABLE_UPLOAD_PROVIDER ??= 'true';
process.env.STRAPI_SKIP_BOOTSTRAP_PERMISSIONS ??= 'true';

const QUESTION = 'Comment déposer une plainte (mécanisme de gestion des plaintes) ?';
const REPONSE = [
  {
    type: 'paragraph',
    children: [
      { type: 'text', text: "Le Projet PRETE dispose d'un mécanisme de gestion des plaintes (MGP), distinct de l'assistance. Vous pouvez déposer une plainte, y compris de manière confidentielle, via les canaux officiels du projet " },
      { type: 'text', text: '(à confirmer par l’UGP : ligne téléphonique dédiée, adresse e-mail, points focaux)', bold: true },
      { type: 'text', text: ". Les plaintes sensibles (EAS/HS) sont traitées de façon confidentielle par un dispositif spécialisé." },
    ],
  },
];

async function main() {
  const appContext = await compileStrapi({ cwd: projectRoot });
  const app = await createStrapi(appContext).load();

  try {
    // 1. Purge orpheline faq-entree (toutes variantes de la question MGP).
    const orphans = await app.documents('api::faq-entree.faq-entree').findMany({
      filters: { question: { $containsi: 'plainte' } },
      pagination: { pageSize: 100 },
    });
    for (const e of orphans) {
      await app.documents('api::faq-entree.faq-entree').delete({ documentId: e.documentId });
      console.log(`faq-entree purgée: ${e.question}`);
    }
    if (orphans.length === 0) console.log('faq-entree: aucune entrée MGP à purger.');

    // 2. Garantit l'entree faq-item (draft OU published), puis publie.
    const existing = await app.documents('api::faq-item.faq-item').findMany({
      filters: { question: { $containsi: 'plainte' } },
      status: 'draft',
      pagination: { pageSize: 100 },
    });
    let documentId;
    if (existing.length > 0) {
      documentId = existing[0].documentId;
      await app.documents('api::faq-item.faq-item').update({
        documentId,
        data: { question: QUESTION, theme: 'dossier', ordre: 4, publie: true, reponse: REPONSE },
      });
      console.log(`faq-item MGP mise à jour: ${documentId}`);
    } else {
      const created = await app.documents('api::faq-item.faq-item').create({
        data: { question: QUESTION, theme: 'dossier', ordre: 4, publie: true, reponse: REPONSE },
      });
      documentId = created.documentId;
      console.log(`faq-item MGP créée: ${documentId}`);
    }
    await app.documents('api::faq-item.faq-item').publish({ documentId });
    console.log('faq-item MGP publiée.');
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
