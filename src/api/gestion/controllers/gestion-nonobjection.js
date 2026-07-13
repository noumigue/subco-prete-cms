'use strict';

// ============================================================================
// M5 · Phase 5 — Non-objection outillee (§6.7 / 6.7.1 / 8.11, Annexe 14).
// Remplace le pont leger E7 (2b) par l'outillage complet EN PRESERVANT son contrat :
//   la publication (gestion-comite) lit toujours `non-objection.statut === 'accordee'`.
// UGP ecrit (creation, pieces, generation, transitions, versions) ; instructeur lit
// (appui Cabinet §6.7) ; comite + operateurs : aucun acces.
// ============================================================================

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { connectRelation, journal } = require('../../../utils/portal-instruction');
const { buildNonObjectionPdf } = require('../../../utils/portal-pdf-comite');

const UID = 'api::non-objection.non-objection';
const UID_VERSION = 'api::version-non-objection.version-non-objection';
const UID_CAS = 'api::cas-non-objection.cas-non-objection';

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

const POPULATE = {
  type: { fields: ['code', 'libelle'] },
  appel: { fields: ['documentId', 'nom', 'codeCohorte'] },
  document: { fields: ['url', 'name'] },
  demandePdf: { fields: ['url', 'name'] },
  demandeRedigee: { fields: ['url', 'name'] },
  pieceEs: { fields: ['url', 'name'] },
  pieceFiduciaire: { fields: ['url', 'name'] },
};

function isSelection(nobj) {
  return ['a', 'b'].includes(nobj?.type?.code);
}

async function findNobj(strapi, documentId) {
  return strapi.documents(UID).findOne({ documentId, populate: POPULATE });
}

// Pieces auto-rattachees : artefacts du 2b lies a l'appel (rapport PDF + PV signe).
async function piecesAuto(strapi, appelDocumentId) {
  if (!appelDocumentId) return { rapport: null, pvSigne: null };
  const [rap, sea] = await Promise.all([
    strapi.documents('api::rapport-evaluation.rapport-evaluation').findMany({ filters: { appel: { documentId: appelDocumentId }, statut: 'valide' }, populate: { pdf: { fields: ['url', 'name'] } }, limit: 1 }),
    strapi.documents('api::seance-comite.seance-comite').findMany({ filters: { appel: { documentId: appelDocumentId } }, populate: { pvSigne: { fields: ['url', 'name'] } }, limit: 1 }),
  ]);
  return { rapport: rap[0]?.pdf?.url ? { url: rap[0].pdf.url, name: rap[0].pdf.name } : null, pvSigne: sea[0]?.pvSigne?.url ? { url: sea[0].pvSigne.url, name: sea[0].pvSigne.name } : null };
}

// Synthese chiffree calculee (I2) depuis les donnees d'instruction et de consolidation.
async function computeSynthese(strapi, appelDocumentId) {
  const candAppel = { candidature: { appel: { documentId: appelDocumentId } } };
  const [recus, comps, elig, cons, evals] = await Promise.all([
    strapi.documents('api::candidature.candidature').findMany({ filters: { appel: { documentId: appelDocumentId }, statut: { code: { $ne: 'brouillon' } }, numeroDossier: { $notNull: true } }, fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::instruction-completude.instruction-completude').findMany({ filters: { ...candAppel, verdictGlobal: 'complet', workflow: 'valide' }, fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({ filters: { ...candAppel, verdictGlobal: 'eligible', workflow: 'valide' }, fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::consolidation.consolidation').findMany({ filters: { ...candAppel, statut: 'figee' }, fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::evaluation-dossier.evaluation-dossier').findMany({ filters: { ...candAppel, reco: { $in: ['selection', 'conditionnelle'] } }, fields: ['documentId'], limit: 1000 }),
  ]);
  return { recus: recus.length, complets: comps.length, eligibles: elig.length, evalues: cons.length, recommandes: evals.length };
}

function serializeRow(n) {
  return {
    documentId: n.documentId,
    objet: n.objet || (n.appel ? `Non-objection — ${n.appel.nom || n.appel.codeCohorte || ''}` : 'Demande de non-objection'),
    type: n.type ? { code: n.type.code, libelle: n.type.libelle } : null,
    reference: n.reference || null,
    statut: n.statut || 'en_preparation',
    version: n.version || 1,
    selection: isSelection(n),
    requise: !!n.requise,
    dateTransmission: n.dateTransmission || null,
    dateAccord: n.dateAccord || null,
  };
}

async function serializeDetail(strapi, n) {
  const auto = isSelection(n) ? await piecesAuto(strapi, n.appel?.documentId) : { rapport: null, pvSigne: null };
  const versions = await strapi.documents(UID_VERSION).findMany({
    filters: { nonObjection: { documentId: n.documentId } },
    populate: { demandePdf: { fields: ['url', 'name'] } },
    sort: 'version:asc',
    limit: 100,
  });
  return {
    ...serializeRow(n),
    appel: n.appel ? { documentId: n.appel.documentId, nom: n.appel.nom, codeCohorte: n.appel.codeCohorte } : null,
    synthese: n.syntheseChiffree || { recus: 0, complets: 0, eligibles: 0, evalues: 0, recommandes: 0 },
    pieces: {
      rapport: auto.rapport,
      pvSigne: auto.pvSigne,
      es: n.pieceEs?.url ? { url: n.pieceEs.url, name: n.pieceEs.name } : null,
      fiduciaire: n.pieceFiduciaire?.url ? { url: n.pieceFiduciaire.url, name: n.pieceFiduciaire.name } : null,
    },
    demandePdf: n.demandePdf?.url ? { url: n.demandePdf.url, name: n.demandePdf.name } : null,
    demandeRedigee: n.demandeRedigee?.url ? { url: n.demandeRedigee.url, name: n.demandeRedigee.name } : null,
    document: n.document?.url ? { url: n.document.url, name: n.document.name } : null,
    observations: n.observations || null,
    ajustements: n.ajustements || null,
    dateObservations: n.dateObservations || null,
    versions: versions.map((v) => ({ version: v.version, dateTransmission: v.dateTransmission || null, observations: v.observations || null, ajustements: v.ajustements || null, demandePdf: v.demandePdf?.url ? { url: v.demandePdf.url, name: v.demandePdf.name } : null })),
  };
}

async function uploadPdfBuffer(strapi, buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-no-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: filename } },
      files: { filepath: tmpPath, originalFilename: filename, mimetype: 'application/pdf', size: buffer.length },
    });
    return uploaded;
  } finally { await fs.unlink(tmpPath).catch(() => undefined); }
}

module.exports = {
  // GET /gestion/non-objection/cas — referentiel des 9 cas (6.7.1).
  async cas(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const items = await strapi.documents(UID_CAS).findMany({ sort: 'ordre:asc', limit: 50 });
    ctx.body = { data: items.map((c) => ({ documentId: c.documentId, code: c.code, libelle: c.libelle })) };
  },

  // GET /gestion/non-objection — registre.
  async demandes(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const items = await strapi.documents(UID).findMany({ populate: POPULATE, sort: 'updatedAt:desc', limit: 200 });
    ctx.body = { data: items.map(serializeRow) };
  },

  // GET /gestion/non-objection/:documentId — detail.
  async demande(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    ctx.body = { data: await serializeDetail(strapi, n) };
  },

  // POST /gestion/non-objection — creation (cas au choix ; demande redigee pour les autres cas).
  async creer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const body = ctx.request.body?.data || {};
    const objet = String(body.objet || '').trim();
    const casDocumentId = String(body.casDocumentId || '').trim();
    if (!objet) return ctx.badRequest("L'objet est requis.");
    if (!casDocumentId) return ctx.badRequest('Le cas est requis.');
    const cas = await strapi.documents(UID_CAS).findOne({ documentId: casDocumentId });
    if (!cas) return ctx.badRequest('Cas invalide.');

    const data = {
      type: { connect: [casDocumentId] },
      objet,
      reference: String(body.reference || '').trim() || null,
      statut: 'en_preparation',
      version: 1,
      requise: true,
    };
    if (body.demandeRedigeeFileId) data.demandeRedigee = body.demandeRedigeeFileId;
    const created = await strapi.documents(UID).create({ data });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_creee', texte: `Demande de non-objection creee : « ${objet} » (cas ${cas.code})` });
    ctx.body = { ok: true, documentId: created.documentId };
  },

  // POST /gestion/non-objection/:documentId/synthese — recalcul serveur OU sauvegarde des valeurs ajustees.
  async synthese(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'en_preparation') return ctx.badRequest('La synthese ne peut etre modifiee qu\'en preparation.');
    const body = ctx.request.body?.data || {};
    let synth;
    if (body.recalculer) {
      if (!n.appel?.documentId) return ctx.badRequest('Aucun appel lie : synthese non calculable automatiquement.');
      synth = await computeSynthese(strapi, n.appel.documentId);
    } else {
      const v = body.valeurs || {};
      const num = (x) => Math.max(0, parseInt(x, 10) || 0);
      synth = { recus: num(v.recus), complets: num(v.complets), eligibles: num(v.eligibles), evalues: num(v.evalues), recommandes: num(v.recommandes) };
    }
    await strapi.documents(UID).update({ documentId: n.documentId, data: { syntheseChiffree: synth } });
    ctx.body = { ok: true, synthese: synth };
  },

  // POST /gestion/non-objection/:documentId/piece — joindre note E&S ou fiduciaire (slot).
  async piece(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'en_preparation') return ctx.badRequest('Les pieces ne peuvent etre modifiees qu\'en preparation.');
    const body = ctx.request.body?.data || {};
    const slot = body.slot;
    const fileId = body.fileId;
    if (!['es', 'fiduciaire'].includes(slot)) return ctx.badRequest('Slot invalide.');
    if (!Number.isInteger(fileId)) return ctx.badRequest('Fichier requis.');
    await strapi.documents(UID).update({ documentId: n.documentId, data: slot === 'es' ? { pieceEs: fileId } : { pieceFiduciaire: fileId } });
    ctx.body = { ok: true };
  },

  // POST /gestion/non-objection/:documentId/generer — lettre Annexe 14 (I2).
  async generer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (!isSelection(n)) return ctx.badRequest('La generation outillee est reservee au cas « selection ».');
    if (n.statut !== 'en_preparation') return ctx.badRequest('La demande n\'est pas en preparation.');
    if (!n.pieceEs?.url) return ctx.badRequest('La note de conformite E&S doit etre jointe avant la generation.');

    const body = ctx.request.body?.data || {};
    const auto = await piecesAuto(strapi, n.appel?.documentId);
    const piecesTransmises = [
      "Rapport d'evaluation",
      'PV du Comite de selection (signe)',
      'Liste des projets recommandes',
      'Tableau des scores',
      "Synthese des verifications d'eligibilite",
      'Note de conformite environnementale et sociale',
      ...(n.pieceFiduciaire?.url ? ['Note fiduciaire'] : []),
    ];
    const pdf = await buildNonObjectionPdf({
      objet: n.objet,
      reference: n.reference,
      casLibelle: n.type?.libelle,
      version: n.version,
      synthese: n.syntheseChiffree || { recus: 0, complets: 0, eligibles: 0, evalues: 0, recommandes: 0 },
      piecesTransmises,
      lieu: String(body.lieu || 'Bujumbura').trim(),
      date: String(body.date || '').trim(),
      signataire: String(body.signataire || 'Le Coordonnateur / La Coordonnatrice du Projet').trim(),
    });
    const file = await uploadPdfBuffer(strapi, pdf, `Demande_non_objection_${(n.reference || 'cohorte').replace(/\s+/g, '_')}_v${n.version}.pdf`);
    await strapi.documents(UID).update({ documentId: n.documentId, data: { demandePdf: file?.id || null } });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_generee', texte: `Demande de non-objection generee (Annexe 14, v${n.version}) : « ${n.objet} »${auto.rapport ? '' : ' [rapport non lie]'}` });
    ctx.body = { ok: true };
  },

  // GET /gestion/non-objection/:documentId/paquet — URLs du paquet a exporter (hors plateforme).
  async paquet(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    const auto = isSelection(n) ? await piecesAuto(strapi, n.appel?.documentId) : { rapport: null, pvSigne: null };
    const files = [];
    if (n.demandePdf?.url) files.push({ label: 'Demande de non-objection (Annexe 14)', url: n.demandePdf.url });
    if (n.demandeRedigee?.url) files.push({ label: 'Demande redigee', url: n.demandeRedigee.url });
    if (auto.rapport) files.push({ label: "Rapport d'evaluation", url: auto.rapport.url });
    if (auto.pvSigne) files.push({ label: 'PV du Comite (signe)', url: auto.pvSigne.url });
    if (n.pieceEs?.url) files.push({ label: 'Note E&S', url: n.pieceEs.url });
    if (n.pieceFiduciaire?.url) files.push({ label: 'Note fiduciaire', url: n.pieceFiduciaire.url });
    ctx.body = { data: { files } };
  },

  // POST /gestion/non-objection/:documentId/transmettre — marquer transmise (I4, hors plateforme).
  async transmettre(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'en_preparation') return ctx.badRequest('Seule une demande en preparation peut etre transmise.');
    if (isSelection(n) ? !n.demandePdf?.url : !n.demandeRedigee?.url) {
      return ctx.badRequest(isSelection(n) ? 'Generez la demande (PDF) avant de transmettre.' : 'Joignez la demande redigee avant de transmettre.');
    }
    await strapi.documents(UID).update({ documentId: n.documentId, data: { statut: 'transmise', dateTransmission: new Date().toISOString().slice(0, 10) } });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_transmise', texte: `Demande de non-objection transmise a la Banque mondiale : « ${n.objet} »` });
    ctx.body = { ok: true };
  },

  // POST /gestion/non-objection/:documentId/accord — enregistrer l'accord (date + document).
  async accord(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'transmise') return ctx.badRequest('Seule une demande transmise peut recevoir un accord.');
    const fileId = ctx.request.body?.data?.documentFileId;
    if (!Number.isInteger(fileId)) return ctx.badRequest("Le document d'accord est requis.");
    await strapi.documents(UID).update({ documentId: n.documentId, data: { statut: 'accordee', dateAccord: new Date().toISOString().slice(0, 10), document: fileId } });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_accordee', texte: `Non-objection accordee par la Banque mondiale : « ${n.objet} » — publication debloquee (contrat 2b)` });
    ctx.body = { ok: true };
  },

  // POST /gestion/non-objection/:documentId/observations — enregistrer des observations (8.11).
  async observations(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'transmise') return ctx.badRequest('Seule une demande transmise peut recevoir des observations.');
    const texte = String(ctx.request.body?.data?.observations || '').trim();
    if (!texte) return ctx.badRequest('Le texte des observations est requis.');
    await strapi.documents(UID).update({ documentId: n.documentId, data: { statut: 'observations', observations: texte, dateObservations: new Date().toISOString().slice(0, 10) } });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_observations', texte: `Observations de la Banque mondiale enregistrees : « ${n.objet} » (§8.11)` });
    ctx.body = { ok: true };
  },

  // POST /gestion/non-objection/:documentId/reversion — re-soumission versionnee (I3).
  async reversion(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const n = await findNobj(strapi, ctx.params.documentId);
    if (!n) return ctx.notFound('Demande introuvable.');
    if (n.statut !== 'observations') return ctx.badRequest('Une nouvelle version n\'est possible qu\'apres des observations.');
    const ajustements = String(ctx.request.body?.data?.ajustements || '').trim();
    if (!ajustements) return ctx.badRequest('Les ajustements documentes sont requis.');

    // Fige la version courante dans l'historique (append-only, I3).
    await strapi.documents(UID_VERSION).create({
      data: {
        nonObjection: connectRelation(n),
        version: n.version || 1,
        dateTransmission: n.dateTransmission || null,
        observations: n.observations || null,
        ajustements,
        demandePdf: n.demandePdf?.id || null,
      },
    });
    // Nouvelle version : retour en preparation (synthese + pieces conservees, ajustables).
    await strapi.documents(UID).update({
      documentId: n.documentId,
      data: {
        version: (n.version || 1) + 1,
        statut: 'en_preparation',
        ajustements,
        demandePdf: null,
        dateTransmission: null,
        observations: null,
        dateObservations: null,
      },
    });
    await journal(strapi, null, { auteurUser: user, type: 'non_objection_reversion', texte: `Non-objection « ${n.objet} » : version ${(n.version || 1) + 1} creee apres observations (8.11)` });
    ctx.body = { ok: true };
  },
};
