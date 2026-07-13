'use strict';

// ============================================================================
// M5 · Phase 2 temps 2 — Rapport, Comité & décisions (Manuel §6.4/6.5, 8.10, Annexes 13/14).
// Consomme les `consolidation` FIGÉES (contrat de sortie du 2a). Chaîne :
//   Cabinet (instructeur) rédige le rapport → UGP valide → Comité (lecture cloisonnée F2)
//   → UGP saisit les décisions + PV → publication atomique par vague (E6/E7).
// Produit : candidatures terminales (selectionne/non_retenu), `subvention` en preparation
// + `conditionPrealable`, notifications, rapport & PV archivés (PDF). Journal 8.1.1.
// ============================================================================

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { connectRelation, displayName, getStatutByCode, journal } = require('../../../utils/portal-instruction');
const { getParams, recoFromScore } = require('../../../utils/portal-evaluation');
const { buildRapportPdf, buildPvPdf } = require('../../../utils/portal-pdf-comite');
const { sendPortalNotification } = require('../../../utils/portal-notify');

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden('Action reservee.'); return null; }
  return user;
}

async function findAppel(strapi, documentId) {
  if (!documentId) return null;
  return strapi.documents('api::appel.appel').findOne({ documentId });
}
async function getParametresComite(strapi) {
  const p = await strapi.documents('api::parametres-comite.parametres-comite').findFirst({});
  return { nbMembres: p?.nbMembres ?? 7, quorumSeuil: p?.quorumSeuil ?? 5 };
}
async function findRapport(strapi, appelDocumentId) {
  const items = await strapi.documents('api::rapport-evaluation.rapport-evaluation').findMany({ filters: { appel: { documentId: appelDocumentId } }, populate: ['pdf'], limit: 1 });
  return items[0] || null;
}
async function ensureRapport(strapi, appel) {
  const found = await findRapport(strapi, appel.documentId);
  if (found) return found;
  return strapi.documents('api::rapport-evaluation.rapport-evaluation').create({ data: { appel: connectRelation(appel), statut: 'brouillon' } });
}
async function findSeance(strapi, appelDocumentId) {
  const items = await strapi.documents('api::seance-comite.seance-comite').findMany({ filters: { appel: { documentId: appelDocumentId } }, populate: ['pvGenere', 'pvSigne'], limit: 1 });
  return items[0] || null;
}
async function ensureSeance(strapi, appel) {
  const found = await findSeance(strapi, appel.documentId);
  if (found) return found;
  return strapi.documents('api::seance-comite.seance-comite').create({ data: { appel: connectRelation(appel), presents: 0, statut: 'ouverte' } });
}
async function findNonObjection(strapi, appelDocumentId) {
  const items = await strapi.documents('api::non-objection.non-objection').findMany({ filters: { appel: { documentId: appelDocumentId } }, populate: ['document'], limit: 1 });
  return items[0] || null;
}
async function findEvalDossier(strapi, candidatureDocumentId) {
  const items = await strapi.documents('api::evaluation-dossier.evaluation-dossier').findMany({ filters: { candidature: { documentId: candidatureDocumentId } }, limit: 1 });
  return items[0] || null;
}

// Classement (6.4.2/6.5.1) sur les consolidations figées : totalFinal desc, puis
// ex aequo Bloc A -> A5 (impact socio-eco) -> taux de contrepartie -> bonus.
async function buildDossierList(strapi, appel, params) {
  const cons = await strapi.documents('api::consolidation.consolidation').findMany({
    filters: { statut: 'figee', candidature: { appel: { documentId: appel.documentId } } },
    populate: { candidature: { populate: { organisation: true, statut: true, owner: { fields: ['id', 'email', 'phone'] } } } },
    limit: 500,
  });
  const items = [];
  for (const c of cons) {
    const cand = c.candidature;
    if (!cand) continue;
    const notesR = c.notesRetenues || {};
    const a5 = Number(notesR?.A5?.retenue ?? notesR?.A5 ?? 0);
    const hasHarmon = Object.values(notesR).some((v) => v && typeof v === 'object' && v.harmonisee);
    const fin = cand.donneesProjet?.financement || {};
    const budget = Number(fin.budgetTotal) || 0;
    const contrepartie = Number(fin.contrepartie) || 0;
    items.push({
      candidatureDocumentId: cand.documentId, ownerId: cand.owner?.id || null, ownerEmail: cand.owner?.email || null, ownerPhone: cand.owner?.phone || null,
      num: cand.numeroDossier || null, op: cand.organisation?.nom || '', proj: cand.titreProjet || '',
      budget, contrepartie, montantSubvention: Math.max(0, budget - contrepartie),
      totalA: Number(c.totalA) || 0, totalB: Number(c.totalB) || 0, bonus: Number(c.bonus) || 0,
      totalHorsBonus: Number(c.totalHorsBonus) || 0, totalFinal: Number(c.totalFinal) || 0, bande: c.bande || '',
      a5, hasHarmon, tauxContrepartie: budget > 0 ? contrepartie / budget : 0,
    });
  }
  items.sort((x, y) => y.totalFinal - x.totalFinal || y.totalA - x.totalA || y.a5 - x.a5 || y.tauxContrepartie - x.tauxContrepartie || y.bonus - x.bonus);
  items.forEach((it, i) => { it.rang = i + 1; });
  return items;
}

// Jointure avec `evaluation-dossier` (créé à la volée, reco pré-remplie depuis la bande).
async function ensureAndJoin(strapi, appel, params) {
  const list = await buildDossierList(strapi, appel, params);
  const out = [];
  for (const it of list) {
    let ed = await findEvalDossier(strapi, it.candidatureDocumentId);
    if (!ed) {
      ed = await strapi.documents('api::evaluation-dossier.evaluation-dossier').create({
        data: { candidature: { connect: [it.candidatureDocumentId] }, rang: it.rang, reco: recoFromScore(it.totalHorsBonus, params), conditions: [], forces: [], faiblesses: [] },
      });
    } else if (ed.rang !== it.rang) {
      ed = await strapi.documents('api::evaluation-dossier.evaluation-dossier').update({ documentId: ed.documentId, data: { rang: it.rang } });
    }
    out.push({ ...it, evalDocumentId: ed.documentId, reco: ed.reco, motifReco: ed.motifReco || null, conditions: ed.conditions || [], forces: ed.forces || [], faiblesses: ed.faiblesses || [], decisionComite: ed.decisionComite || null, motifAjustement: ed.motifAjustement || null });
  }
  return out;
}

async function uploadPdfBuffer(strapi, buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: filename } },
      files: { filepath: tmpPath, originalFilename: filename, mimetype: 'application/pdf', size: buffer.length },
    });
    return uploaded;
  } finally { await fs.unlink(tmpPath).catch(() => undefined); }
}

const RECO_LBL = { selection: 'Sélection', conditionnelle: 'Conditionnelle', attente: "Liste d'attente", rejet: 'Rejet' };
// Correspondance décision -> reco par défaut (pour détecter un écart nécessitant un motif).
const DECISION_DE_RECO = { selection: 'retenu', conditionnelle: 'conditions', attente: 'attente', rejet: 'rejete' };

module.exports = {
  // ===========================================================================
  // 1. RAPPORT & CLASSEMENT (Cabinet=instructeur + UGP)
  // ===========================================================================
  async rapport(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const rapport = await ensureRapport(strapi, appel);
    const dossiers = await ensureAndJoin(strapi, appel, params);
    ctx.body = {
      data: {
        appel: { documentId: appel.documentId, nom: appel.nom, codeCohorte: appel.codeCohorte },
        statut: rapport.statut, commentaireRenvoi: rapport.commentaireRenvoi || null, pdfUrl: rapport.pdf?.url || null,
        dossiers: dossiers.map((d) => serializeDossier(d)),
      },
    };
  },

  async rapportDossier(ctx) {
    const user = requireRole(ctx, ['instructeur', 'ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const rapport = await ensureRapport(strapi, appel);
    if (rapport.statut !== 'brouillon') return ctx.badRequest('Le rapport n\'est plus modifiable (soumis/validé).');
    const payload = ctx.request.body?.data || {};
    const ed = await findEvalDossier(strapi, payload.candidatureId);
    if (!ed) return ctx.badRequest('Dossier introuvable.');
    const data = {};
    if (['selection', 'conditionnelle', 'attente', 'rejet'].includes(payload.reco)) data.reco = payload.reco;
    if (payload.motifReco !== undefined) data.motifReco = String(payload.motifReco || '');
    if (Array.isArray(payload.conditions)) data.conditions = payload.conditions;
    if (Array.isArray(payload.forces)) data.forces = payload.forces;
    if (Array.isArray(payload.faiblesses)) data.faiblesses = payload.faiblesses;
    await strapi.documents('api::evaluation-dossier.evaluation-dossier').update({ documentId: ed.documentId, data });
    ctx.body = { ok: true };
  },

  async rapportSoumettre(ctx) {
    const user = requireRole(ctx, ['instructeur', 'ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const rapport = await ensureRapport(strapi, appel);
    if (rapport.statut !== 'brouillon') return ctx.badRequest('Rapport déjà soumis.');
    const dossiers = await ensureAndJoin(strapi, appel, params);
    if (!dossiers.length) return ctx.badRequest('Aucune consolidation figée : rien à rapporter.');
    // Garde : une reco conditionnelle exige des conditions (6.5.2).
    const manque = dossiers.find((d) => d.reco === 'conditionnelle' && !(Array.isArray(d.conditions) && d.conditions.length));
    if (manque) return ctx.badRequest(`Le dossier ${manque.num} est « conditionnel » : renseignez au moins une condition.`);
    await strapi.documents('api::rapport-evaluation.rapport-evaluation').update({ documentId: rapport.documentId, data: { statut: 'soumis', soumisPar: { connect: [user.id] }, soumisLe: new Date().toISOString(), commentaireRenvoi: null } });
    ctx.body = { ok: true };
  },

  async rapportValider(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const rapport = await ensureRapport(strapi, appel);
    if (rapport.statut !== 'soumis') return ctx.badRequest('Aucun rapport soumis à valider.');
    const dossiers = await ensureAndJoin(strapi, appel, params);
    // F1 : PDF pré-généré archivé (6.6).
    const pdf = await buildRapportPdf({ appel, dossiers });
    const file = await uploadPdfBuffer(strapi, pdf, `rapport-evaluation-${appel.codeCohorte || 'cohorte'}.pdf`);
    await strapi.documents('api::rapport-evaluation.rapport-evaluation').update({ documentId: rapport.documentId, data: { statut: 'valide', validePar: { connect: [user.id] }, valideLe: new Date().toISOString(), pdf: file?.id || null } });
    ctx.body = { ok: true };
  },

  async rapportRenvoyer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const rapport = await ensureRapport(strapi, appel);
    if (rapport.statut !== 'soumis') return ctx.badRequest('Aucun rapport à renvoyer.');
    await strapi.documents('api::rapport-evaluation.rapport-evaluation').update({ documentId: rapport.documentId, data: { statut: 'brouillon', commentaireRenvoi: String(ctx.request.body?.data?.commentaire || '').trim() || null } });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // 2. DOSSIER DE SÉANCE (Comité — lecture cloisonnée F2)
  // ===========================================================================
  async seance(ctx) {
    if (!requireRole(ctx, ['comite', 'ugp'])) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    ctx.body = { data: await seanceBody(appel) };
  },

  // Résout la séance « courante » sans exiger la liste des appels (le Comité n'y a pas accès, F2).
  // Appel courant = celui dont le rapport est validé, sinon l'appel ouvert.
  async seanceCourante(ctx) {
    if (!requireRole(ctx, ['comite', 'ugp'])) return;
    const rapports = await strapi.documents('api::rapport-evaluation.rapport-evaluation').findMany({ filters: { statut: 'valide' }, populate: ['appel'], sort: ['valideLe:desc'], limit: 1 });
    let appel = rapports[0]?.appel || null;
    if (!appel?.documentId) appel = await strapi.documents('api::appel.appel').findFirst({ filters: { statut: 'ouvert' } });
    if (!appel?.documentId) { ctx.body = { data: { ready: false } }; return; }
    ctx.body = { data: await seanceBody(appel) };
  },

  // ===========================================================================
  // 3. DÉCISIONS DU COMITÉ (secrétariat UGP)
  // ===========================================================================
  async decisions(ctx) {
    if (!requireRole(ctx, ['ugp'])) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const rapport = await ensureRapport(strapi, appel);
    if (rapport.statut !== 'valide') { ctx.body = { data: { ready: false } }; return; }
    const [paramsC, seance, dossiers] = await Promise.all([getParametresComite(strapi), ensureSeance(strapi, appel), ensureAndJoin(strapi, appel, params)]);
    ctx.body = {
      data: {
        ready: true,
        appel: { documentId: appel.documentId, nom: appel.nom, codeCohorte: appel.codeCohorte },
        parametres: paramsC, presents: seance.presents || 0, statut: seance.statut,
        pvGenereUrl: seance.pvGenere?.url || null, pvSigneUrl: seance.pvSigne?.url || null,
        dossiers: dossiers.map((d) => ({ candidatureId: d.candidatureDocumentId, num: d.num, op: d.op, proj: d.proj, totalFinal: d.totalFinal, reco: d.reco, decisionComite: d.decisionComite, motifAjustement: d.motifAjustement })),
      },
    };
  },

  async decisionDossier(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const seance = await ensureSeance(strapi, appel);
    if (seance.statut === 'close') return ctx.badRequest('Séance close : décisions figées.');
    const payload = ctx.request.body?.data || {};
    const ed = await findEvalDossier(strapi, payload.candidatureId);
    if (!ed) return ctx.badRequest('Dossier introuvable.');
    const decision = payload.decisionComite;
    if (!['retenu', 'conditions', 'rejete', 'attente'].includes(decision)) return ctx.badRequest('Décision invalide.');
    // 6.4.3 : tout écart à la reco exige un motif.
    const ecart = DECISION_DE_RECO[ed.reco] !== decision;
    const motif = String(payload.motifAjustement || '').trim();
    if (ecart && !motif) return ctx.badRequest('Écart à la recommandation : motif d\'ajustement obligatoire (6.4.3).');
    // « Retenu sous conditions » exige des conditions.
    if (decision === 'conditions' && !(Array.isArray(ed.conditions) && ed.conditions.length)) return ctx.badRequest('« Retenu sous conditions » exige au moins une condition (renseignée au rapport).');
    await strapi.documents('api::evaluation-dossier.evaluation-dossier').update({ documentId: ed.documentId, data: { decisionComite: decision, motifAjustement: ecart ? motif : null } });
    ctx.body = { ok: true };
  },

  async decisionPresents(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const seance = await ensureSeance(strapi, appel);
    if (seance.statut === 'close') return ctx.badRequest('Séance close.');
    const presents = Math.max(0, Number(ctx.request.body?.data?.presents) || 0);
    await strapi.documents('api::seance-comite.seance-comite').update({ documentId: seance.documentId, data: { presents } });
    ctx.body = { ok: true };
  },

  async genererPv(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const [paramsC, seance, dossiers] = await Promise.all([getParametresComite(strapi), ensureSeance(strapi, appel), ensureAndJoin(strapi, appel, params)]);
    if (!dossiers.every((d) => d.decisionComite)) return ctx.badRequest('Renseignez toutes les décisions avant de générer le PV.');
    const body = ctx.request.body?.data || {};
    const pdf = await buildPvPdf({ appel, dossiers, presents: seance.presents || 0, nbMembres: paramsC.nbMembres, president: body.president, lieu: body.lieu, dateSeance: body.dateSeance, reserves: body.reserves });
    const file = await uploadPdfBuffer(strapi, pdf, `pv-comite-${appel.codeCohorte || 'cohorte'}.pdf`);
    await strapi.documents('api::seance-comite.seance-comite').update({ documentId: seance.documentId, data: { pvGenere: file?.id || null, reserves: body.reserves || null } });
    ctx.body = { ok: true };
  },

  async joindrePvSigne(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const fileId = ctx.request.body?.data?.pvSigneFileId;
    if (!fileId) return ctx.badRequest('Fichier du PV signé requis.');
    const seance = await ensureSeance(strapi, appel);
    await strapi.documents('api::seance-comite.seance-comite').update({ documentId: seance.documentId, data: { pvSigne: fileId } });
    ctx.body = { ok: true };
  },

  async cloreSeance(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const [paramsC, seance, dossiers] = await Promise.all([getParametresComite(strapi), ensureSeance(strapi, appel), ensureAndJoin(strapi, appel, params)]);
    if (seance.statut === 'close') return ctx.badRequest('Séance déjà close.');
    if ((seance.presents || 0) < paramsC.quorumSeuil) return ctx.badRequest(`Quorum non atteint (${seance.presents || 0}/${paramsC.quorumSeuil}).`);
    if (!dossiers.every((d) => d.decisionComite)) return ctx.badRequest('Toutes les décisions doivent être saisies.');
    await strapi.documents('api::seance-comite.seance-comite').update({ documentId: seance.documentId, data: { statut: 'close', closePar: { connect: [user.id] }, closeLe: new Date().toISOString() } });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // 4. PUBLICATION (UGP) + pont non-objection E7
  // ===========================================================================
  async publication(ctx) {
    if (!requireRole(ctx, ['ugp'])) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const [seance, nobj, pub, dossiers] = await Promise.all([ensureSeance(strapi, appel), findNonObjection(strapi, appel.documentId), strapi.documents('api::publication-decisions.publication-decisions').findMany({ filters: { appel: { documentId: appel.documentId } }, limit: 1 }), ensureAndJoin(strapi, appel, params)]);
    ctx.body = {
      data: {
        seanceClose: seance.statut === 'close',
        publiee: !!pub[0],
        nonObjection: nobj ? { requise: !!nobj.requise, statut: nobj.statut, dateAccord: nobj.dateAccord || null } : { requise: false, statut: 'en_preparation', dateAccord: null },
        pvSigne: !!seance.pvSigne,
        appel: { documentId: appel.documentId, nom: appel.nom, codeCohorte: appel.codeCohorte },
        dossiers: dossiers.map((d) => ({ op: d.op, decisionComite: d.decisionComite })),
      },
    };
  },

  async nonObjection(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const payload = ctx.request.body?.data || {};
    let nobj = await findNonObjection(strapi, appel.documentId);
    if (!nobj) nobj = await strapi.documents('api::non-objection.non-objection').create({ data: { appel: connectRelation(appel), requise: false, statut: 'en_preparation' } });
    const data = {};
    if (payload.requise !== undefined) data.requise = !!payload.requise;
    if (payload.action === 'transmise') { data.statut = 'transmise'; data.dateTransmission = new Date().toISOString().slice(0, 10); }
    if (payload.action === 'accordee') {
      if (!payload.documentFileId) return ctx.badRequest('Document de l\'accord requis.');
      data.statut = 'accordee'; data.dateAccord = new Date().toISOString().slice(0, 10); data.document = payload.documentFileId;
    }
    await strapi.documents('api::non-objection.non-objection').update({ documentId: nobj.documentId, data });
    if (payload.action) await journal(strapi, null, { auteurUser: user, type: 'non_objection', texte: `Non-objection BM : ${payload.action === 'accordee' ? 'accord enregistré' : 'demande transmise'} (§6.7)` });
    ctx.body = { ok: true };
  },

  async publier(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const appel = await findAppel(strapi, ctx.params.documentId);
    if (!appel?.documentId) return ctx.notFound('Appel introuvable.');
    const params = await getParams(strapi);
    const [seance, nobj, existing, dossiers] = await Promise.all([ensureSeance(strapi, appel), findNonObjection(strapi, appel.documentId), strapi.documents('api::publication-decisions.publication-decisions').findMany({ filters: { appel: { documentId: appel.documentId } }, limit: 1 }), ensureAndJoin(strapi, appel, params)]);
    // Préconditions (A.3.8).
    if (existing[0]) return ctx.badRequest('Décisions déjà publiées.');
    if (seance.statut !== 'close') return ctx.badRequest('La séance doit être close avant publication.');
    if (!seance.pvSigne) return ctx.badRequest('Le PV signé doit être joint avant publication.');
    if (nobj?.requise && nobj.statut !== 'accordee') return ctx.badRequest('Non-objection requise : publication bloquée jusqu\'à l\'accord (§6.7).');
    if (!dossiers.every((d) => d.decisionComite)) return ctx.badRequest('Toutes les décisions doivent être saisies.');

    const notifs = [];
    // Effets atomiques (E6) : tout ou rien.
    await strapi.db.transaction(async () => {
      const [sSelectionne, sNonRetenu] = await Promise.all([getStatutByCode(strapi, 'selectionne'), getStatutByCode(strapi, 'non_retenu')]);
      for (const d of dossiers) {
        const dec = d.decisionComite;
        if (dec === 'retenu' || dec === 'conditions') {
          await strapi.documents('api::candidature.candidature').update({ documentId: d.candidatureDocumentId, data: { statut: connectRelation(sSelectionne) } });
          // Création de la subvention en préparation (Lot 2).
          let subvention = await strapi.documents('api::subvention.subvention').findFirst({ filters: { candidature: { documentId: d.candidatureDocumentId } } });
          if (!subvention) {
            subvention = await strapi.documents('api::subvention.subvention').create({
              data: { owner: d.ownerId, candidature: { connect: [d.candidatureDocumentId] }, statut: 'preparation', montantTotal: String(d.budget), montantSubvention: String(d.montantSubvention), montantContrepartie: String(d.contrepartie), montantDecaisse: '0' },
            });
          }
          if (dec === 'conditions') {
            const conds = Array.isArray(d.conditions) ? d.conditions : [];
            for (let i = 0; i < conds.length; i++) {
              const c = conds[i];
              await strapi.documents('api::condition-prealable.condition-prealable').create({
                data: { subvention: connectRelation(subvention), libelle: c.texte || 'Condition à lever', statut: c.type === 'es' || c.type === 'site' ? 'action_requise' : 'en_cours_ugp', ordre: (i + 1) * 10 },
              });
            }
          }
          await journal(strapi, d.candidatureDocumentId, { auteurUser: user, type: 'publication', texte: `Décision publiée : sélectionné${dec === 'conditions' ? ' sous conditions' : ''} — subvention en préparation` });
          notifs.push({ d, sujet: 'Votre projet a été sélectionné', corps: `Félicitations : le dossier ${d.num} a été retenu par le Comité de sélection${dec === 'conditions' ? ', sous réserve de conditions préalables' : ''}. La préparation de votre convention démarre — retrouvez-la dans « Ma subvention ».` });
        } else if (dec === 'rejete') {
          await strapi.documents('api::candidature.candidature').update({ documentId: d.candidatureDocumentId, data: { statut: connectRelation(sNonRetenu), ...(d.motifAjustement ? { motifDecisionCourt: d.motifAjustement } : {}) } });
          await journal(strapi, d.candidatureDocumentId, { auteurUser: user, type: 'publication', texte: 'Décision publiée : non retenu — notification signée à joindre' });
          notifs.push({ d, sujet: 'Décision : projet non retenu', corps: `Le dossier ${d.num} n\'a pas été retenu par le Comité de sélection. Une notification de décision vous sera transmise.` });
        } else {
          // liste d'attente : aucun changement visible candidat (E6).
          await journal(strapi, d.candidatureDocumentId, { auteurUser: user, type: 'publication', texte: 'Décision publiée : liste d\'attente — dossier maintenu en instruction' });
        }
      }
      await strapi.documents('api::publication-decisions.publication-decisions').create({ data: { appel: connectRelation(appel), publieePar: { connect: [user.id] }, publieeLe: new Date().toISOString() } });
    });

    // Notifications hors transaction (best effort ; l'accord de non-objection a déjà été vérifié — E7).
    for (const n of notifs) {
      await sendPortalNotification(strapi, { userId: n.d.ownerId, email: n.d.ownerEmail, telephone: n.d.ownerPhone, candidature: { documentId: n.d.candidatureDocumentId }, sujet: n.sujet, corps: n.corps });
    }
    ctx.body = { ok: true };
  },
};

// Corps de la vue de séance (F2 : vue consolidée, jamais de nom d'évaluateur).
async function seanceBody(appel) {
  const params = await getParams(strapi);
  const rapport = await ensureRapport(strapi, appel);
  if (rapport.statut !== 'valide') return { ready: false };
  const dossiers = await ensureAndJoin(strapi, appel, params);
  return {
    ready: true,
    appel: { documentId: appel.documentId, nom: appel.nom, codeCohorte: appel.codeCohorte },
    rapportPdfUrl: rapport.pdf?.url || null,
    dossiers: dossiers.map((d) => ({ rang: d.rang, op: d.op, proj: d.proj, totalFinal: d.totalFinal, totalA: d.totalA, totalB: d.totalB, bonus: d.bonus, bande: d.bande, reco: d.reco, forces: d.forces, faiblesses: d.faiblesses, conditions: d.conditions })),
  };
}

function serializeDossier(d) {
  return {
    candidatureId: d.candidatureDocumentId, rang: d.rang, num: d.num, op: d.op, proj: d.proj,
    totalA: d.totalA, totalB: d.totalB, bonus: d.bonus, totalHorsBonus: d.totalHorsBonus, totalFinal: d.totalFinal, bande: d.bande, hasHarmon: d.hasHarmon,
    reco: d.reco, motifReco: d.motifReco, conditions: d.conditions, forces: d.forces, faiblesses: d.faiblesses,
    decisionComite: d.decisionComite,
  };
}
