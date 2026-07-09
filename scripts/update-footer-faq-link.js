#!/usr/bin/env node
/*
 * Repointe le lien de footer « FAQ » (groupe aide) vers l'ancre FAQ de la home.
 * Local uniquement (boot Strapi). Pour la prod, utiliser l'API REST (voir commande curl).
 */
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);

const UID = 'api::footer-link.footer-link';
const NEW_URL = '/#home-faq';

async function main() {
  const app = await createStrapi(await compileStrapi({ cwd: projectRoot })).load();
  try {
    for (const status of ['draft', 'published']) {
      const links = await app.documents(UID).findMany({ status, pagination: { pageSize: 200 } });
      for (const link of links) {
        if (link.group === 'aide' && (link.label || '').toLowerCase() === 'faq') {
          await app.documents(UID).update({
            documentId: link.documentId,
            data: { url: NEW_URL },
          });
          await app.documents(UID).publish({ documentId: link.documentId });
          console.log(`✓ (${status}) ${link.label} : ${link.url} -> ${NEW_URL}`);
        }
      }
    }
  } finally {
    await app.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
