#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);

function parseArgs(argv) {
  const options = {
    inDir: path.join(projectRoot, 'exports', 'value-chains'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--in-dir' && argv[index + 1]) {
      options.inDir = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable requise manquante: ${name}`);
  return value;
}

function getHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Requête échouée ${response.status} ${response.statusText} sur ${url}\n${body}`);
  }
  return response.status === 204 ? null : response.json();
}

async function getAllTargetFiles(baseUrl, token) {
  const files = await requestJson(`${baseUrl}/api/upload/files`, {
    headers: getHeaders(token),
  });
  return new Map(files.map((file) => [file.name, file]));
}

async function uploadFile(baseUrl, token, filePath, metadata) {
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append(
    'files',
    new Blob([fileBuffer], { type: metadata.mime || 'application/octet-stream' }),
    metadata.name || path.basename(filePath),
  );
  if (metadata.alternativeText) form.append('fileInfo', JSON.stringify({ alternativeText: metadata.alternativeText, caption: metadata.caption || null }));

  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: getHeaders(token),
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Upload échoué pour ${filePath}: ${response.status} ${response.statusText}\n${body}`);
  }

  const files = await response.json();
  return files[0];
}

async function findValueChain(baseUrl, token, slug) {
  const query = new URLSearchParams({
    'filters[slug][$eq]': slug,
    status: 'draft',
  });

  const out = await requestJson(`${baseUrl}/api/value-chains?${query.toString()}`, {
    headers: getHeaders(token),
  });

  return out.data?.[0] || null;
}

async function upsertValueChain(baseUrl, token, item, heroImageId, existingDocumentId) {
  const payload = {
    data: {
      name: item.name,
      slug: item.slug,
      shortIntro: item.shortIntro,
      fullContent: item.fullContent,
      priorityOrder: item.priorityOrder,
      isFeaturedHome: item.isFeaturedHome,
      photoHint: item.photoHint,
      heroImage: heroImageId ?? null,
    },
  };

  if (existingDocumentId) {
    const url = `${baseUrl}/api/value-chains/${existingDocumentId}${item.published ? '?status=published' : ''}`;
    return requestJson(url, {
      method: 'PUT',
      headers: getHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  }

  const url = `${baseUrl}/api/value-chains${item.published ? '?status=published' : ''}`;
  return requestJson(url, {
    method: 'POST',
    headers: getHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(options.inDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest introuvable: ${manifestPath}`);
  }

  const baseUrl = getRequiredEnv('TARGET_STRAPI_URL').replace(/\/$/, '');
  const token = getRequiredEnv('TARGET_STRAPI_TOKEN');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const knownFiles = await getAllTargetFiles(baseUrl, token);

  for (const item of manifest.items || []) {
    let heroImageId = null;

    if (item.heroImage?.exportFile) {
      const assetPath = path.join(options.inDir, item.heroImage.exportFile);
      if (!fs.existsSync(assetPath)) {
        throw new Error(`Asset introuvable pour ${item.slug}: ${assetPath}`);
      }

      const existingFile = knownFiles.get(item.heroImage.name);
      if (existingFile) {
        heroImageId = existingFile.id;
      } else {
        const uploaded = await uploadFile(baseUrl, token, assetPath, item.heroImage);
        knownFiles.set(uploaded.name, uploaded);
        heroImageId = uploaded.id;
      }
    }

    const existing = await findValueChain(baseUrl, token, item.slug);
    await upsertValueChain(baseUrl, token, item, heroImageId, existing?.documentId);
    console.log(`${existing ? 'Mise à jour' : 'Création'}: ${item.slug}`);
  }

  console.log('Import value chains terminé.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
