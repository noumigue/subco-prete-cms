'use strict';

// ============================================================================
// M5 · Phase 3 — Actes de subvention (côté UGP). Miroir de « Ma subvention » :
// chaque acte ÉCRIT l'état que le portail bénéficiaire (Lot 2) LIT déjà.
// Séparation des fonctions §8.15 : le Cabinet (instructeur) dépose les AVIS
// TECHNIQUES ; l'UGP VALIDE / DÉCIDE (fiduciaire), signe, suspend. Tout acte est
// journalisé (acte-dossier, append-only), horodaté, nominatif. Aucun code opérateur touché.
// ============================================================================

const { connectRelation, displayName, journal } = require('../../../utils/portal-instruction');
const { sendPortalNotification } = require('../../../utils/portal-notify');

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

const SUBVENTION_POPULATE = {
  owner: { fields: ['id', 'email', 'phone', 'orgName'] },
  candidature: { fields: ['documentId', 'numeroDossier', 'titreProjet'] },
  conditionsPrealables: { populate: { avisTechniquePar: { fields: ['id', 'orgName', 'username'] }, valideePar: { fields: ['id', 'orgName', 'username'] } } },
  demandes: { populate: { modalite: true, statut: true, pieces: true, justificationPieces: true, acd: true } },
  jalons: { populate: ['etape'] },
  mesuresCorrectives: true,
  rapports: { populate: ['type'] },
  pdfConvention: true,
};

async function findSubvention(strapi, documentId) {
  if (!documentId) return null;
  return strapi.documents('api::subvention.subvention').findOne({ documentId, populate: SUBVENTION_POPULATE });
}
// Charge un enfant + sa subvention (owner, candidature) pour journal/notification.
async function findChildOfSubvention(strapi, uid, documentId, extra = {}) {
  if (!documentId) return null;
  return strapi.documents(uid).findOne({
    documentId,
    populate: { subvention: { populate: { owner: { fields: ['id', 'email', 'phone'] }, candidature: { fields: ['documentId'] } } }, ...extra },
  });
}
async function getStatutDemande(strapi, code) {
  return strapi.documents('api::statut-demande.statut-demande').findFirst({ filters: { code } });
}
function notifyTargets(sub) {
  return { userId: sub?.owner?.id, email: sub?.owner?.email, telephone: sub?.owner?.phone };
}
function candDocId(sub) {
  return sub?.candidature?.documentId || null;
}

function serializeSubventionRow(s) {
  return {
    documentId: s.documentId,
    numeroConvention: s.numeroConvention || null,
    op: s.owner?.orgName || s.candidature?.titreProjet || '',
    proj: s.candidature?.titreProjet || '',
    statut: s.statut,
    montantSubvention: s.montantSubvention != null ? String(s.montantSubvention) : null,
    montantTotal: s.montantTotal != null ? String(s.montantTotal) : null,
  };
}

module.exports = {
  // ===========================================================================
  // LISTE / DÉTAIL
  // ===========================================================================
  async subventions(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const list = await strapi.documents('api::subvention.subvention').findMany({
      populate: { owner: { fields: ['orgName'] }, candidature: { fields: ['titreProjet', 'numeroDossier'] } },
      sort: ['updatedAt:desc'], limit: 500,
    });
    ctx.body = { data: list.map(serializeSubventionRow) };
  },

  async subvention(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const s = await findSubvention(strapi, ctx.params.documentId);
    if (!s?.documentId) return ctx.notFound('Subvention introuvable.');

    const money = (v) => (v != null ? String(v) : null);
    ctx.body = {
      data: {
        ...serializeSubventionRow(s),
        dateSignature: s.dateSignature || null,
        montantContrepartie: money(s.montantContrepartie),
        montantDecaisse: money(s.montantDecaisse),
        motifSuspension: s.motifSuspension || null,
        pdfConventionUrl: s.pdfConvention?.url || null,
        conditions: (s.conditionsPrealables || []).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map((c) => ({
          documentId: c.documentId, libelle: c.libelle, statut: c.statut, echeance: c.echeance || null, ordre: c.ordre || 0,
          technique: !!c.technique, avisTechnique: c.avisTechnique || null, avisTechniqueCommentaire: c.avisTechniqueCommentaire || null,
          avisTechniquePar: c.avisTechniquePar ? displayName(c.avisTechniquePar) : null,
          valideePar: c.valideePar ? displayName(c.valideePar) : null, valideeLe: c.valideeLe || c.dateValidation || null,
        })),
        demandes: (s.demandes || []).sort((a, b) => (a.numero || 0) - (b.numero || 0)).map((d) => ({
          documentId: d.documentId, numero: d.numero, montant: money(d.montant), objet: d.objet || null,
          modalite: d.modalite?.libelle || null, modaliteCode: d.modalite?.code || null,
          statut: d.statut?.code || null, statutLibelle: d.statut?.libelleBeneficiaire || null,
          avisTechnique: d.avisTechnique || null, avisTechniqueCommentaire: d.avisTechniqueCommentaire || null,
          avisFiduciaire: d.avisFiduciaire || null, motifRejet: d.motifRejet || null,
          aJustifier: !!d.aJustifier, justificationStatut: d.justificationStatut || 'non_requise',
          pieces: (d.pieces || []).map((p) => ({ name: p.name, url: p.url })),
          justificationPieces: (d.justificationPieces || []).map((p) => ({ name: p.name, url: p.url })),
          acdUrl: d.acd?.url || null,
        })),
        jalons: (s.jalons || []).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map((j) => ({
          documentId: j.documentId, libelle: j.etape?.libelle || j.etape?.code || 'Jalon', datePrevue: j.datePrevue || null, dateReelle: j.dateReelle || null,
        })),
        mesures: (s.mesuresCorrectives || []).map((m) => ({ documentId: m.documentId, description: m.description, echeance: m.echeance || null, statut: m.statut })),
        rapports: (s.rapports || []).sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map((r) => ({ type: r.type?.libelle || r.type?.code || 'Rapport', periode: r.periodeLibelle || null, statut: r.statut, dateTransmission: r.dateTransmission || null })),
      },
    };
  },

  // ===========================================================================
  // G1 — CONDITIONS PRÉALABLES
  // ===========================================================================
  async conditionAvisTechnique(ctx) {
    const user = requireRole(ctx, ['instructeur', 'ugp']);
    if (!user) return;
    const c = await findChildOfSubvention(strapi, 'api::condition-prealable.condition-prealable', ctx.params.documentId);
    if (!c?.documentId) return ctx.notFound('Condition introuvable.');
    if (c.statut === 'validee') return ctx.badRequest('Condition déjà validée.');
    const avis = ctx.request.body?.data?.avisTechnique;
    if (!['favorable', 'reserve', 'defavorable'].includes(avis)) return ctx.badRequest('Avis technique invalide.');
    await strapi.documents('api::condition-prealable.condition-prealable').update({
      documentId: c.documentId,
      data: { avisTechnique: avis, avisTechniqueCommentaire: String(ctx.request.body?.data?.commentaire || '').trim() || null, avisTechniquePar: { connect: [user.id] } },
    });
    await journal(strapi, candDocId(c.subvention), { auteurUser: user, type: 'condition_avis', texte: `Avis technique sur condition « ${c.libelle} » : ${avis}` });
    ctx.body = { ok: true };
  },

  async conditionValider(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const c = await findChildOfSubvention(strapi, 'api::condition-prealable.condition-prealable', ctx.params.documentId);
    if (!c?.documentId) return ctx.notFound('Condition introuvable.');
    await strapi.documents('api::condition-prealable.condition-prealable').update({
      documentId: c.documentId,
      data: { statut: 'validee', valideePar: { connect: [user.id] }, valideeLe: new Date().toISOString(), dateValidation: new Date().toISOString().slice(0, 10) },
    });
    await journal(strapi, candDocId(c.subvention), { auteurUser: user, type: 'condition_validee', texte: `Condition validée : « ${c.libelle} »` });
    ctx.body = { ok: true };
  },

  async conditionActionRequise(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const c = await findChildOfSubvention(strapi, 'api::condition-prealable.condition-prealable', ctx.params.documentId);
    if (!c?.documentId) return ctx.notFound('Condition introuvable.');
    if (c.statut === 'validee') return ctx.badRequest('Condition déjà validée.');
    const echeance = ctx.request.body?.data?.echeance || null;
    await strapi.documents('api::condition-prealable.condition-prealable').update({ documentId: c.documentId, data: { statut: 'action_requise', ...(echeance ? { echeance } : {}) } });
    await journal(strapi, candDocId(c.subvention), { auteurUser: user, type: 'condition_action', texte: `Action requise du bénéficiaire — condition « ${c.libelle} »` });
    await sendPortalNotification(strapi, { ...notifyTargets(c.subvention), candidature: candDocId(c.subvention) ? { documentId: candDocId(c.subvention) } : null, sujet: 'Action requise sur votre convention', corps: `Une condition préalable requiert une action de votre part : « ${c.libelle} ». Rendez-vous dans « Ma subvention » → Préparation.` });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // G2 — SIGNATURE DE LA CONVENTION → subvention active + bascule bénéficiaire
  // ===========================================================================
  async signer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const s = await findSubvention(strapi, ctx.params.documentId);
    if (!s?.documentId) return ctx.notFound('Subvention introuvable.');
    if (s.statut !== 'preparation') return ctx.badRequest('La subvention n\'est pas en préparation.');
    const conds = s.conditionsPrealables || [];
    if (!conds.length || !conds.every((c) => c.statut === 'validee')) {
      return ctx.badRequest('Toutes les conditions préalables doivent être validées avant la signature (§8.12).');
    }
    const body = ctx.request.body?.data || {};
    const numeroConvention = String(body.numeroConvention || '').trim() || s.numeroConvention;
    const dateSignature = body.dateSignature || new Date().toISOString().slice(0, 10);
    if (!numeroConvention) return ctx.badRequest('Le numéro de convention est requis.');

    const beneRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'beneficiaire' } });

    await strapi.db.transaction(async () => {
      await strapi.documents('api::subvention.subvention').update({
        documentId: s.documentId,
        data: { statut: 'active', numeroConvention, dateSignature, signeePar: { connect: [user.id] }, ...(body.pdfConventionFileId ? { pdfConvention: body.pdfConventionFileId } : {}) },
      });
      // Bascule candidat -> bénéficiaire à la signature (§8.13).
      if (s.owner?.id && beneRole?.id) {
        await strapi.db.query('plugin::users-permissions.user').update({ where: { id: s.owner.id }, data: { role: beneRole.id } });
      }
      await journal(strapi, candDocId(s), { auteurUser: user, type: 'signature', texte: `Convention ${numeroConvention} signée — subvention ACTIVE, bascule bénéficiaire` });
    });
    await sendPortalNotification(strapi, { ...notifyTargets(s), candidature: candDocId(s) ? { documentId: candDocId(s) } : null, sujet: 'Votre convention est signée', corps: `Votre convention ${numeroConvention} est enregistrée. Votre subvention est désormais active — retrouvez le suivi du projet et les décaissements dans « Ma subvention ».` });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // G3 — DÉCAISSEMENTS (circuit 11.4)
  // ===========================================================================
  async decaissementAvisTechnique(ctx) {
    const user = requireRole(ctx, ['instructeur', 'ugp']);
    if (!user) return;
    const d = await findChildOfSubvention(strapi, 'api::demande-decaissement.demande-decaissement', ctx.params.documentId, { statut: true });
    if (!d?.documentId) return ctx.notFound('Demande introuvable.');
    if (!['soumise', 'avis_technique'].includes(d.statut?.code)) return ctx.badRequest('Cette demande n\'attend pas d\'avis technique.');
    const avis = ctx.request.body?.data?.avisTechnique;
    if (!['favorable', 'favorable_reserve', 'defavorable'].includes(avis)) return ctx.badRequest('Avis technique invalide.');
    const statutFid = await getStatutDemande(strapi, 'avis_fiduciaire');
    await strapi.documents('api::demande-decaissement.demande-decaissement').update({
      documentId: d.documentId,
      data: { avisTechnique: avis, avisTechniqueCommentaire: String(ctx.request.body?.data?.commentaire || '').trim() || null, avisTechniquePar: { connect: [user.id] }, statut: connectRelation(statutFid) },
    });
    await journal(strapi, candDocId(d.subvention), { auteurUser: user, type: 'decaissement_avis_technique', texte: `Avis technique (Cabinet) sur la demande N°${String(d.numero).padStart(2, '0')} : ${avis} — transmis à l'UGP` });
    ctx.body = { ok: true };
  },

  async decaissementAvisFiduciaire(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const d = await findChildOfSubvention(strapi, 'api::demande-decaissement.demande-decaissement', ctx.params.documentId, { statut: true, modalite: true });
    if (!d?.documentId) return ctx.notFound('Demande introuvable.');
    if (d.statut?.code !== 'avis_fiduciaire') return ctx.badRequest('Cette demande n\'est pas au stade de l\'avis fiduciaire.');
    const decision = ctx.request.body?.data?.decision;
    const commentaire = String(ctx.request.body?.data?.commentaire || '').trim();
    const acdFileId = ctx.request.body?.data?.acdFileId || null;
    if (!['approuve', 'retour', 'rejete'].includes(decision)) return ctx.badRequest('Décision invalide.');
    if ((decision === 'retour' || decision === 'rejete') && !commentaire) return ctx.badRequest('Un motif est obligatoire pour un retour ou un rejet (11.6).');

    const sub = await findSubvention(strapi, d.subvention.documentId);
    let notif = null;
    await strapi.db.transaction(async () => {
      if (decision === 'approuve') {
        const statutPayee = await getStatutDemande(strapi, 'payee');
        const estAvance = d.modalite?.code === 'avance';
        await strapi.documents('api::demande-decaissement.demande-decaissement').update({
          documentId: d.documentId,
          data: { statut: connectRelation(statutPayee), avisFiduciaire: 'approuve', avisFiduciaireCommentaire: commentaire || null, avisFiduciairePar: { connect: [user.id] }, decisionLe: new Date().toISOString(), ...(acdFileId ? { acd: acdFileId } : {}), ...(estAvance ? { aJustifier: true, justificationStatut: 'attendue' } : {}) },
        });
        // Cumul décaissé.
        const nouveau = String(BigInt(sub.montantDecaisse || '0') + BigInt(d.montant || '0'));
        await strapi.documents('api::subvention.subvention').update({ documentId: sub.documentId, data: { montantDecaisse: nouveau } });
        await journal(strapi, candDocId(d.subvention), { auteurUser: user, type: 'decaissement_payee', texte: `Demande N°${String(d.numero).padStart(2, '0')} approuvée — paiement direct au fournisseur (§8.14)` });
        notif = { sujet: 'Décaissement approuvé', corps: `Votre demande N°${String(d.numero).padStart(2, '0')} est approuvée. Le paiement est effectué selon la modalité retenue.${estAvance ? ' Cette avance devra être justifiée avant tout nouveau décaissement (11.4).' : ''}` };
      } else {
        const code = decision === 'retour' ? 'complements_requis' : 'rejetee';
        const statut = await getStatutDemande(strapi, code);
        await strapi.documents('api::demande-decaissement.demande-decaissement').update({
          documentId: d.documentId,
          data: { statut: connectRelation(statut), avisFiduciaire: decision === 'retour' ? 'complements' : 'rejete', avisFiduciaireCommentaire: commentaire, motifRejet: commentaire, avisFiduciairePar: { connect: [user.id] }, decisionLe: new Date().toISOString() },
        });
        await journal(strapi, candDocId(d.subvention), { auteurUser: user, type: 'decaissement_decision', texte: `Demande N°${String(d.numero).padStart(2, '0')} ${decision === 'retour' ? 'retournée pour correction' : 'rejetée'} — motif consigné` });
        notif = { sujet: decision === 'retour' ? 'Demande de décaissement à corriger' : 'Demande de décaissement rejetée', corps: `Votre demande N°${String(d.numero).padStart(2, '0')} a été ${decision === 'retour' ? 'retournée pour correction' : 'rejetée'}. Motif : ${commentaire}` };
      }
    });
    if (notif) await sendPortalNotification(strapi, { ...notifyTargets(d.subvention), candidature: candDocId(d.subvention) ? { documentId: candDocId(d.subvention) } : null, sujet: notif.sujet, corps: notif.corps });
    ctx.body = { ok: true };
  },

  // G4 — justification d'avance (11.4)
  async justificationValider(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const d = await findChildOfSubvention(strapi, 'api::demande-decaissement.demande-decaissement', ctx.params.documentId);
    if (!d?.documentId) return ctx.notFound('Demande introuvable.');
    if (!d.aJustifier || d.justificationStatut !== 'soumise') return ctx.badRequest('Aucune justification à valider.');
    await strapi.documents('api::demande-decaissement.demande-decaissement').update({ documentId: d.documentId, data: { justificationStatut: 'validee' } });
    await journal(strapi, candDocId(d.subvention), { auteurUser: user, type: 'justification_validee', texte: `Justification de l'avance N°${String(d.numero).padStart(2, '0')} validée — nouveau décaissement débloqué (11.4)` });
    await sendPortalNotification(strapi, { ...notifyTargets(d.subvention), candidature: candDocId(d.subvention) ? { documentId: candDocId(d.subvention) } : null, sujet: 'Justification validée', corps: `La justification de votre avance N°${String(d.numero).padStart(2, '0')} est validée. Vous pouvez soumettre une nouvelle demande de décaissement.` });
    ctx.body = { ok: true };
  },

  async justificationComplement(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const d = await findChildOfSubvention(strapi, 'api::demande-decaissement.demande-decaissement', ctx.params.documentId);
    if (!d?.documentId) return ctx.notFound('Demande introuvable.');
    if (!d.aJustifier || d.justificationStatut !== 'soumise') return ctx.badRequest('Aucune justification à traiter.');
    await strapi.documents('api::demande-decaissement.demande-decaissement').update({ documentId: d.documentId, data: { justificationStatut: 'attendue' } });
    await journal(strapi, candDocId(d.subvention), { auteurUser: user, type: 'justification_complement', texte: `Complément de justification demandé pour l'avance N°${String(d.numero).padStart(2, '0')}` });
    await sendPortalNotification(strapi, { ...notifyTargets(d.subvention), candidature: candDocId(d.subvention) ? { documentId: candDocId(d.subvention) } : null, sujet: 'Complément de justification demandé', corps: `Un complément est requis pour justifier votre avance N°${String(d.numero).padStart(2, '0')}.` });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // G5 — JALONS
  // ===========================================================================
  async jalonDateReelle(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const j = await findChildOfSubvention(strapi, 'api::jalon-projet.jalon-projet', ctx.params.documentId, { etape: true });
    if (!j?.documentId) return ctx.notFound('Jalon introuvable.');
    const dateReelle = ctx.request.body?.data?.dateReelle;
    if (!dateReelle) return ctx.badRequest('Date réelle requise.');
    await strapi.documents('api::jalon-projet.jalon-projet').update({ documentId: j.documentId, data: { dateReelle, saisiPar: { connect: [user.id] } } });
    await journal(strapi, candDocId(j.subvention), { auteurUser: user, type: 'jalon', texte: `Date réelle saisie pour le jalon « ${j.etape?.libelle || 'jalon'} » : ${dateReelle}` });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // G6 — MESURES CORRECTIVES + SUSPENSION
  // ===========================================================================
  async mesureEmettre(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const s = await findSubvention(strapi, ctx.params.documentId);
    if (!s?.documentId) return ctx.notFound('Subvention introuvable.');
    const description = String(ctx.request.body?.data?.description || '').trim();
    if (!description) return ctx.badRequest('La description de la mesure est requise.');
    await strapi.documents('api::mesure-corrective.mesure-corrective').create({
      data: { subvention: connectRelation(s), description, echeance: ctx.request.body?.data?.echeance || null, statut: 'en_cours', emisePar: { connect: [user.id] } },
    });
    await journal(strapi, candDocId(s), { auteurUser: user, type: 'mesure_emise', texte: `Mesure corrective émise : ${description}` });
    await sendPortalNotification(strapi, { ...notifyTargets(s), candidature: candDocId(s) ? { documentId: candDocId(s) } : null, sujet: 'Mesure corrective requise', corps: `Une mesure corrective vous est demandée : ${description}. Déposez la régularisation depuis « Ma subvention » → Suivi du projet.` });
    ctx.body = { ok: true };
  },

  async mesureValider(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const m = await findChildOfSubvention(strapi, 'api::mesure-corrective.mesure-corrective', ctx.params.documentId);
    if (!m?.documentId) return ctx.notFound('Mesure introuvable.');
    if (m.statut === 'regularisee') return ctx.badRequest('Mesure déjà régularisée.');
    await strapi.documents('api::mesure-corrective.mesure-corrective').update({ documentId: m.documentId, data: { statut: 'regularisee', valideePar: { connect: [user.id] }, valideeLe: new Date().toISOString() } });
    await journal(strapi, candDocId(m.subvention), { auteurUser: user, type: 'mesure_validee', texte: `Régularisation validée : ${m.description}` });
    ctx.body = { ok: true };
  },

  async suspendre(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const s = await findSubvention(strapi, ctx.params.documentId);
    if (!s?.documentId) return ctx.notFound('Subvention introuvable.');
    if (s.statut !== 'active') return ctx.badRequest('Seule une subvention active peut être suspendue.');
    const motif = String(ctx.request.body?.data?.motif || '').trim();
    await strapi.documents('api::subvention.subvention').update({ documentId: s.documentId, data: { statut: 'suspendue', motifSuspension: motif || null } });
    await journal(strapi, candDocId(s), { auteurUser: user, type: 'suspension', texte: `Subvention suspendue (§8.15)${motif ? ' — ' + motif : ''}` });
    await sendPortalNotification(strapi, { ...notifyTargets(s), candidature: candDocId(s) ? { documentId: candDocId(s) } : null, sujet: 'Subvention suspendue', corps: `Votre subvention est suspendue (paiements gelés).${motif ? ' Motif : ' + motif : ''}` });
    ctx.body = { ok: true };
  },

  async lever(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const s = await findSubvention(strapi, ctx.params.documentId);
    if (!s?.documentId) return ctx.notFound('Subvention introuvable.');
    if (s.statut !== 'suspendue') return ctx.badRequest('Subvention non suspendue.');
    await strapi.documents('api::subvention.subvention').update({ documentId: s.documentId, data: { statut: 'active', motifSuspension: null } });
    await journal(strapi, candDocId(s), { auteurUser: user, type: 'levee', texte: 'Suspension levée — subvention de nouveau active' });
    await sendPortalNotification(strapi, { ...notifyTargets(s), candidature: candDocId(s) ? { documentId: candDocId(s) } : null, sujet: 'Suspension levée', corps: 'Votre subvention est de nouveau active.' });
    ctx.body = { ok: true };
  },
};
