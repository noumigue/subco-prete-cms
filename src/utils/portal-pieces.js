'use strict';

// Resolution des fichiers reellement deposes pour les pieces d'un dossier.
//
// Le depot de piece n'est PAS une relation media Strapi : `donneesProjet.pieces[]` porte
// un `fileId` brut (plus le PGES sous `es.pges.fileId`). Tant que ces ids ne sont pas
// resolus en URL, aucun ecran ne peut ouvrir un document — l'instructeur jugerait la
// conformite (8.6) a l'aveugle, et le candidat ne pourrait pas relire ce qu'il a envoye.
//
// Lecture seule, aucun effet de bord. Retourne { [fileId]: { url, nom, mime, tailleKo } }.

async function resolvePiecesFichiers(strapi, donneesProjet) {
  const pieces = Array.isArray(donneesProjet?.pieces) ? donneesProjet.pieces : [];
  const ids = pieces.map((p) => Number(p?.fileId)).filter((n) => Number.isInteger(n) && n > 0);

  const pgesId = Number(donneesProjet?.es?.pges?.fileId);
  if (Number.isInteger(pgesId) && pgesId > 0) ids.push(pgesId);

  if (ids.length === 0) return {};

  const fichiers = await strapi.db.query('plugin::upload.file').findMany({
    where: { id: { $in: [...new Set(ids)] } },
    select: ['id', 'name', 'url', 'mime', 'size'],
  });

  return Object.fromEntries(
    fichiers.map((f) => [
      String(f.id),
      { url: f.url, nom: f.name, mime: f.mime || null, tailleKo: f.size ? Math.round(f.size) : null },
    ]),
  );
}

module.exports = { resolvePiecesFichiers };
