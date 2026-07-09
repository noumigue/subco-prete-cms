#!/usr/bin/env node
/*
 * Pousse les documents & ressources (manuel + annexes) vers un Strapi distant (prod)
 * via l'API REST + token, sur le modèle de import-value-chains.js.
 *
 * Env requis :
 *   TARGET_STRAPI_URL    ex. https://cms.subco-prete.bi
 *   TARGET_STRAPI_TOKEN  token API (write) du CMS cible
 * Env optionnel :
 *   PDF_DIR  dossier des PDF (défaut : scratchpad de préparation)
 *
 * Idempotent : purge des entrées existantes de même titre (draft + published)
 * avant recréation ; réutilise un média déjà uploadé portant le même nom.
 */
const fs = require('fs');
const path = require('path');

// Dossier des PDF sources ; surchargeable via la variable d'env PDF_DIR.
const PDF_DIR = process.env.PDF_DIR || path.join(__dirname, '..', 'exports', 'resource-documents');

const UID_PATH = 'resource-documents';

const DOCS = require('./resource-documents-data');

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable requise manquante: ${name}`);
  return value;
}

function getHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
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
  const files = await requestJson(`${baseUrl}/api/upload/files`, { headers: getHeaders(token) });
  return new Map(files.map((f) => [f.name, f]));
}

async function uploadFile(baseUrl, token, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('files', new Blob([buf], { type: 'application/pdf' }), name);
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: getHeaders(token),
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload échoué (${name}): ${res.status} ${res.statusText}\n${body}`);
  }
  return (await res.json())[0];
}

async function purgeByTitle(baseUrl, token, title) {
  for (const status of ['draft', 'published']) {
    const q = new URLSearchParams({ 'filters[title][$eq]': title, status });
    const out = await requestJson(`${baseUrl}/api/${UID_PATH}?${q}`, { headers: getHeaders(token) });
    for (const entry of out.data || []) {
      await requestJson(`${baseUrl}/api/${UID_PATH}/${entry.documentId}?status=${status}`, {
        method: 'DELETE',
        headers: getHeaders(token),
      });
      console.log(`  purge (${status}) : ${title}`);
    }
  }
}

async function createPublished(baseUrl, token, doc, fileId) {
  const payload = {
    data: {
      title: doc.title,
      category: doc.category,
      description: doc.description,
      file: fileId,
    },
  };
  return requestJson(`${baseUrl}/api/${UID_PATH}?status=published`, {
    method: 'POST',
    headers: getHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}

async function main() {
  const baseUrl = getRequiredEnv('TARGET_STRAPI_URL').replace(/\/$/, '');
  const token = getRequiredEnv('TARGET_STRAPI_TOKEN');

  console.log(`Cible : ${baseUrl}\n`);
  const knownFiles = await getAllTargetFiles(baseUrl, token);

  for (const doc of DOCS) {
    const absPath = path.join(PDF_DIR, doc.file);
    if (!fs.existsSync(absPath)) throw new Error(`PDF introuvable : ${absPath}`);

    await purgeByTitle(baseUrl, token, doc.title);

    // réutilise le média s'il existe déjà (même nom), sinon upload
    const baseName = doc.fileName.replace(/\.pdf$/i, '');
    let media = [...knownFiles.values()].find(
      (f) => f.name === doc.fileName || (f.name && f.name.startsWith(baseName)),
    );
    if (!media) {
      media = await uploadFile(baseUrl, token, absPath, doc.fileName);
      knownFiles.set(media.name, media);
    }

    await createPublished(baseUrl, token, doc, media.id);
    console.log(`✓ ${doc.category.padEnd(11)} ${doc.title}`);
  }

  const check = await requestJson(
    `${baseUrl}/api/${UID_PATH}?status=published&pagination[pageSize]=200`,
    { headers: getHeaders(token) },
  );
  console.log(`\nTotal publiés sur la cible : ${check.meta?.pagination?.total ?? (check.data || []).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
