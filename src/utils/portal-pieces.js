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

// Vue « Pieces du dossier » pour les ecrans d'evaluation : une ligne par type de piece du
// referentiel, avec le fichier depose, le complement recu qui le remplace (le plus recent), ou
// « non fourni ». Les pieces ajoutees d'elles-memes par le candidat sans type connu vont dans
// `autres`. Lecture seule. Le rapprochement complement <-> type de piece se fait par libelle :
// c'est le libelle du referentiel que la demande de complement recopie.
async function construirePiecesDossier(strapi, candidature) {
  const cle = (l) => String(l || '').trim().toLowerCase();
  const [typePieces, fichiers, complements] = await Promise.all([
    strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 }),
    resolvePiecesFichiers(strapi, candidature.donneesProjet),
    strapi.documents('api::complement.complement').findMany({
      filters: { candidature: { documentId: candidature.documentId }, statut: 'fourni' },
      populate: { fichier: true }, sort: ['updatedAt:desc'], limit: 100,
    }),
  ]);
  const deposees = Array.isArray(candidature.donneesProjet?.pieces) ? candidature.donneesProjet.pieces : [];
  const recus = complements.filter((c) => c.fichier?.url);
  const utilises = new Set();

  const pieces = typePieces.map((tp) => {
    const depot = deposees.find((d) => d && d.id === tp.documentId && d.depose && d.fileId);
    const f = depot ? fichiers[String(depot.fileId)] : null;
    const complement = recus.find((c) => !utilises.has(c.documentId) && cle(c.pieceDemandee) === cle(tp.libelle));
    if (complement) utilises.add(complement.documentId);
    return {
      libelle: tp.libelle,
      groupe: tp.groupe || 'autre',
      exigence: tp.exigence || null,
      depot: f?.url ? { url: f.url, nom: f.nom || depot.nomFichier || 'Fichier' } : null,
      complement: complement ? { url: complement.fichier.url, nom: complement.fichier.name || 'Complément', recuLe: complement.updatedAt || null } : null,
    };
  });

  // PGES depose dans le volet E&S du formulaire, hors liste des pieces.
  const pges = fichiers[String(candidature.donneesProjet?.es?.pges?.fileId || '')];
  const lignePges = pieces.find((p) => /pges|gestion environnementale/i.test(p.libelle));
  if (pges?.url && lignePges && !lignePges.depot) lignePges.depot = { url: pges.url, nom: pges.nom || 'PGES' };

  const autres = recus
    .filter((c) => !utilises.has(c.documentId))
    .map((c) => ({ libelle: c.pieceDemandee || 'Pièce ajoutée', url: c.fichier.url, nom: c.fichier.name || 'Fichier', spontanee: c.origine === 'candidat' }));

  return { pieces, autres };
}

// Pieces envoyees par le CANDIDAT dans le module Assistance. Elles ne vivaient que dans le fil
// de la demande : l'instructeur, l'UGP et l'evaluateur ne les voyaient pas la ou ils travaillent.
// Rattachement en deux temps : par le dossier lie a la demande, et a defaut par le compte du
// candidat (des demandes sont ouvertes sans preciser le dossier).
async function chargerPiecesAssistance(strapi, candidature, complements = []) {
  const ownerId = candidature.owner?.id || null;
  const ou = [{ concerneCandidature: { documentId: candidature.documentId } }];
  if (ownerId) ou.push({ owner: { id: ownerId }, concerneCandidature: { documentId: { $null: true } } });
  const demandes = await strapi.documents('api::demande-assistance.demande-assistance').findMany({
    filters: { $or: ou },
    populate: { messages: { populate: { pieces: { fields: ['id', 'url', 'name', 'mime', 'size'] } }, sort: 'envoyeLe:asc' } },
    limit: 200,
  });
  // Ce qui a deja ete verse au dossier, par fichier : l'ecran doit dire « versee comme X ».
  const versees = new Map();
  for (const c of complements) {
    const fid = c.fichier?.id;
    if (!fid || c.statut !== 'fourni') continue;
    if (!versees.has(fid)) versees.set(fid, []);
    versees.get(fid).push(c.pieceDemandee || 'Piece');
  }
  const out = [];
  for (const d of demandes) {
    for (const m of d.messages || []) {
      if (m.auteur !== 'operateur') continue; // jamais les pieces de l'equipe
      for (const f of m.pieces || []) {
        if (!f?.id) continue;
        out.push({
          fileId: f.id,
          nom: f.name || 'Piece',
          url: f.url || null,
          envoyeLe: m.envoyeLe || null,
          demandeDocumentId: d.documentId,
          demandeObjet: d.objet || 'Demande d\'assistance',
          rattachementDossier: Boolean(d.concerneCandidature),
          verseeComme: versees.get(f.id) || [],
        });
      }
    }
  }
  out.sort((a, b) => String(b.envoyeLe || '').localeCompare(String(a.envoyeLe || '')));
  return out;
}

module.exports = { resolvePiecesFichiers, construirePiecesDossier, chargerPiecesAssistance };
