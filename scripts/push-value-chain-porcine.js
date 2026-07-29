#!/usr/bin/env node
/*
 * Ajoute (ou met à jour) la chaîne de valeur « Élevage porcin » sur un Strapi cible,
 * positionnée JUSTE AVANT « Projet transversal ».
 *
 * Env requis :
 *   TARGET_STRAPI_URL    ex. http://localhost:1338  ou  https://cms.subco-prete.bi
 *   TARGET_STRAPI_TOKEN  token API (write) du CMS cible
 *
 * Idempotent :
 *   - réutilise le média déjà uploadé portant le même nom (cv_porcine.jpeg) ;
 *   - upsert de la value-chain slug « porcine » (create sinon update), publiée ;
 *   - repositionne « projet-transversal » à priorityOrder 7 pour que porcine (6) passe avant.
 *
 * Usage : TARGET_STRAPI_URL=... TARGET_STRAPI_TOKEN=... node scripts/push-value-chain-porcine.js
 */
const fs = require('fs');
const path = require('path');
const DATA = require('./value-chain-porcine-data');

const IMAGE_PATH = path.join(__dirname, 'assets', 'cv_porcine.jpeg');
const IMAGE_NAME = 'cv_porcine.jpeg';

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variable requise manquante : ${name}`);
  return v;
}
function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}
async function reqJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${url}\n${text}`);
  return text ? JSON.parse(text) : null;
}

async function findFileByName(base, token, name) {
  const files = await reqJson(`${base}/api/upload/files?filters[name][$eq]=${encodeURIComponent(name)}`, { headers: headers(token) });
  const arr = Array.isArray(files) ? files : files?.data || [];
  return arr[0] || null;
}
async function uploadImage(base, token) {
  const existing = await findFileByName(base, token, IMAGE_NAME);
  if (existing) {
    console.log(`• Image déjà présente (id ${existing.id}) — réutilisée.`);
    return existing.id;
  }
  const buf = fs.readFileSync(IMAGE_PATH);
  const form = new FormData();
  form.append('files', new Blob([buf], { type: 'image/jpeg' }), IMAGE_NAME);
  const res = await fetch(`${base}/api/upload`, { method: 'POST', headers: headers(token), body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload image échoué : ${res.status}\n${text}`);
  const id = JSON.parse(text)[0].id;
  console.log(`• Image uploadée (id ${id}).`);
  return id;
}

async function findChain(base, token, slug) {
  for (const status of ['published', 'draft']) {
    const out = await reqJson(`${base}/api/value-chains?filters[slug][$eq]=${slug}&status=${status}`, { headers: headers(token) });
    const entry = (out?.data || [])[0];
    if (entry) return entry;
  }
  return null;
}

async function main() {
  const base = requiredEnv('TARGET_STRAPI_URL').replace(/\/+$/, '');
  const token = requiredEnv('TARGET_STRAPI_TOKEN');
  console.log(`Cible : ${base}`);

  const heroId = await uploadImage(base, token);

  // 1) Décaler « projet-transversal » à 7 (pour laisser la place 6 à porcine).
  const transversal = await findChain(base, token, 'projet-transversal');
  if (transversal && transversal.priorityOrder !== 7) {
    await reqJson(`${base}/api/value-chains/${transversal.documentId}?status=published`, {
      method: 'PUT', headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: { priorityOrder: 7 } }),
    });
    console.log('• « Projet transversal » repositionné à priorityOrder 7.');
  } else if (transversal) {
    console.log('• « Projet transversal » déjà à 7.');
  } else {
    console.log('! « projet-transversal » introuvable — porcine sera quand même à 6.');
  }

  // 2) Upsert de la chaîne porcine (publiée), heroImage rattachée.
  const payload = {
    name: DATA.name,
    slug: DATA.slug,
    photoHint: DATA.photoHint,
    shortIntro: DATA.shortIntro,
    isFeaturedHome: DATA.isFeaturedHome,
    priorityOrder: DATA.priorityOrder,
    fullContent: DATA.fullContent,
    heroImage: heroId,
  };
  const existing = await findChain(base, token, DATA.slug);
  if (existing) {
    await reqJson(`${base}/api/value-chains/${existing.documentId}?status=published`, {
      method: 'PUT', headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: payload }),
    });
    console.log(`• Chaîne « ${DATA.name} » mise à jour (documentId ${existing.documentId}).`);
  } else {
    const created = await reqJson(`${base}/api/value-chains?status=published`, {
      method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: payload }),
    });
    console.log(`• Chaîne « ${DATA.name} » créée (documentId ${created?.data?.documentId}).`);
  }

  console.log('\n✅ Terminé. Ordre attendu : … 5 mines · 6 Élevage porcin · 7 Projet transversal.');
}

main().catch((e) => { console.error('\n❌ Échec :', e.message); process.exit(1); });
