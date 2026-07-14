'use strict';

// ============================================================================
// M6 — Suivi-evaluation (§14). Couche de RESTITUTION : agregations a la demande
// (no-store), depouillement interne des rapports (K1, Cabinet saisit -> UGP valide),
// rapport de synthese PDF (K4). La plateforme est la source ; rien de calcule n'est
// stocke. UGP = tout ; instructeur (Cabinet) = lecture + saisie/proposition du
// depouillement ; comite + operateurs = aucun acces.
// ============================================================================

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { journal, displayName } = require('../../../utils/portal-instruction');
const { buildSyntheseSePdf } = require('../../../utils/portal-pdf-comite');

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

// Filtre cohorte optionnel (documentId d'appel). Les autres filtres (filiere/province)
// sont appliques au niveau candidature quand c'est pertinent.
function appelFilter(ctx) {
  const c = ctx.query?.cohorte;
  return c && c !== 'toutes' ? c : null;
}

const D = 86400000; // ms/jour
function toNum(v) { try { return Number(BigInt(v || '0')); } catch { return Number(v) || 0; } }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function avgDays(pairs) {
  const ds = pairs.filter(([a, b]) => a && b).map(([a, b]) => (new Date(b) - new Date(a)) / D).filter((x) => x >= 0);
  if (!ds.length) return null;
  return Math.round((ds.reduce((s, x) => s + x, 0) / ds.length) * 10) / 10;
}

// --------------------------------------------------------------------------
// Chargements de base (une fois par requete de tableau de bord / indicateurs).
// --------------------------------------------------------------------------
async function loadSubventions(strapi, appel) {
  const filters = appel ? { candidature: { appel: { documentId: appel } } } : {};
  return strapi.documents('api::subvention.subvention').findMany({
    filters,
    fields: ['documentId', 'statut', 'montantSubvention', 'montantContrepartie', 'montantDecaisse'],
    populate: { owner: { fields: ['id'] }, candidature: { fields: ['documentId', 'donneesProjet'] } },
    limit: 500,
  });
}

async function loadDemandes(strapi, appel) {
  const filters = appel ? { subvention: { candidature: { appel: { documentId: appel } } } } : {};
  return strapi.documents('api::demande-decaissement.demande-decaissement').findMany({
    filters, fields: ['documentId', 'montant', 'aJustifier', 'justificationStatut'],
    populate: { statut: { fields: ['code'] } }, limit: 1000,
  });
}

async function validatedDepouillements(strapi, appel) {
  const filters = { statut: 'valide', ...(appel ? { rapportRequis: { subvention: { candidature: { appel: { documentId: appel } } } } } : {}) };
  const rows = await strapi.documents('api::depouillement-rapport.depouillement-rapport').findMany({ filters, fields: ['valeurs'], limit: 1000 });
  const agg = { empT: 0, empF: 0, empJ: 0, empR: 0, benef: 0, inv: 0, incidents: 0 };
  for (const r of rows) {
    const v = r.valeurs || {};
    for (const k of Object.keys(agg)) agg[k] += Number(v[k]) || 0;
  }
  return agg;
}

async function saisieValeur(strapi, code) {
  const items = await strapi.documents('api::valeur-indicateur-saisie.valeur-indicateur-saisie').findMany({
    filters: { indicateur: { code } }, sort: 'saisiLe:desc', fields: ['valeur'], limit: 1,
  });
  return items[0] ? Number(items[0].valeur) : null;
}

// Entonnoir (K2) : recus -> complets -> eligibles -> evalues -> selectionnes.
async function computeEntonnoir(strapi, appel) {
  const candAppel = (extra) => (appel ? { candidature: { appel: { documentId: appel } }, ...extra } : { ...extra });
  const candFilter = appel ? { appel: { documentId: appel }, statut: { code: { $ne: 'brouillon' } }, numeroDossier: { $notNull: true } } : { statut: { code: { $ne: 'brouillon' } }, numeroDossier: { $notNull: true } };
  const [recus, complets, eligibles, evalues, subs] = await Promise.all([
    strapi.documents('api::candidature.candidature').findMany({ filters: candFilter, fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::instruction-completude.instruction-completude').findMany({ filters: candAppel({ verdictGlobal: 'complet', workflow: 'valide' }), fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::instruction-eligibilite.instruction-eligibilite').findMany({ filters: candAppel({ verdictGlobal: 'eligible', workflow: 'valide' }), fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::consolidation.consolidation').findMany({ filters: candAppel({ statut: 'figee' }), fields: ['documentId'], limit: 1000 }),
    strapi.documents('api::subvention.subvention').findMany({ filters: appel ? { candidature: { appel: { documentId: appel } } } : {}, fields: ['documentId'], limit: 500 }),
  ]);
  return [
    { label: 'Reçus', v: recus.length },
    { label: 'Complets', v: complets.length },
    { label: 'Éligibles', v: eligibles.length },
    { label: 'Évalués', v: evalues.length },
    { label: 'Sélectionnés', v: subs.length },
  ];
}

// Execution financiere : engage / decaisse / justifie.
function computeExecution(subventions, demandes) {
  const actifs = subventions.filter((s) => ['active', 'suspendue', 'cloturee'].includes(s.statut));
  const engage = actifs.reduce((s, x) => s + toNum(x.montantSubvention), 0);
  const decaisse = demandes.filter((d) => d.statut?.code === 'payee').reduce((s, x) => s + toNum(x.montant), 0);
  const justifie = demandes.filter((d) => d.aJustifier && d.justificationStatut === 'validee').reduce((s, x) => s + toNum(x.montant), 0);
  return { engage, decaisse, justifie };
}

// Delais moyens par etape, calcules des horodatages du journal acte-dossier (8.1.1).
async function computeDelais(strapi, appel) {
  const candFilter = appel ? { appel: { documentId: appel }, numeroDossier: { $notNull: true } } : { numeroDossier: { $notNull: true } };
  const cands = await strapi.documents('api::candidature.candidature').findMany({ filters: candFilter, fields: ['documentId', 'dateDepot'], limit: 1000 });
  const ids = cands.map((c) => c.documentId);
  if (!ids.length) return { completude: null, eligibilite: null, evaluation: null, paiement: null };
  const actes = await strapi.documents('api::acte-dossier.acte-dossier').findMany({
    filters: { candidature: { documentId: { $in: ids } } },
    fields: ['type', 'date'], populate: { candidature: { fields: ['documentId'] } }, sort: 'date:asc', limit: 5000,
  });
  const byCand = {};
  for (const a of actes) {
    const cid = a.candidature?.documentId; if (!cid) continue;
    (byCand[cid] = byCand[cid] || {})[a.type] = a.date;
  }
  const depot = Object.fromEntries(cands.map((c) => [c.documentId, c.dateDepot]));
  const pairsComp = [], pairsElig = [], pairsEval = [];
  for (const cid of ids) {
    const j = byCand[cid] || {};
    if (depot[cid] && j.validation_completude) pairsComp.push([depot[cid], j.validation_completude]);
    if (j.validation_completude && j.validation_eligibilite) pairsElig.push([j.validation_completude, j.validation_eligibilite]);
    if (j.validation_eligibilite && j.figeage) pairsEval.push([j.validation_eligibilite, j.figeage]);
  }
  // Paiement : entre creation de la demande et l'acte decaissement_payee.
  const demandes = await strapi.documents('api::demande-decaissement.demande-decaissement').findMany({
    filters: appel ? { subvention: { candidature: { appel: { documentId: appel } } } } : {},
    fields: ['createdAt', 'numero'], populate: { statut: { fields: ['code'] } }, limit: 1000,
  });
  const payeeActes = actes.filter((a) => a.type === 'decaissement_payee').map((a) => a.date).sort();
  const payeeDemandes = demandes.filter((d) => d.statut?.code === 'payee').map((d) => d.createdAt).sort();
  const pairsPay = payeeDemandes.map((c, i) => [c, payeeActes[i]]).filter(([, b]) => b);
  return {
    completude: avgDays(pairsComp),
    eligibilite: avgDays(pairsElig),
    evaluation: avgDays(pairsEval),
    paiement: avgDays(pairsPay),
  };
}

// Alertes operationnelles (K2) : chaque item porte la reference et le lien back-office.
async function computeAlertes(strapi, appel) {
  const nowIso = new Date().toISOString().slice(0, 10);
  const subFilter = appel ? { candidature: { appel: { documentId: appel } } } : {};
  const [complements, avances, rapports, mesures, jalons] = await Promise.all([
    strapi.documents('api::complement.complement').findMany({ filters: { statut: 'demande', echeance: { $lt: nowIso } }, populate: { candidature: { fields: ['documentId', 'numeroDossier'] } }, limit: 200 }),
    strapi.documents('api::demande-decaissement.demande-decaissement').findMany({ filters: { aJustifier: true, justificationStatut: { $ne: 'validee' } }, fields: ['documentId', 'numero'], populate: { subvention: { fields: ['documentId'], populate: { candidature: { fields: ['numeroDossier'] } } } }, limit: 200 }),
    strapi.documents('api::rapport-requis.rapport-requis').findMany({ filters: { statut: 'echu' }, fields: ['documentId', 'periodeLibelle'], populate: { subvention: { fields: ['documentId'], populate: { candidature: { fields: ['numeroDossier'] } } }, type: { fields: ['libelle', 'code'] } }, limit: 200 }),
    strapi.documents('api::mesure-corrective.mesure-corrective').findMany({ filters: { statut: 'en_cours' }, fields: ['documentId', 'description'], populate: { subvention: { fields: ['documentId'], populate: { candidature: { fields: ['numeroDossier'] } } } }, limit: 200 }),
    strapi.documents('api::jalon-projet.jalon-projet').findMany({ filters: { datePrevue: { $lt: nowIso }, dateReelle: { $null: true } }, fields: ['documentId', 'datePrevue'], populate: { etape: { fields: ['libelle'] }, subvention: { fields: ['documentId'], populate: { candidature: { fields: ['numeroDossier'] } } } }, limit: 200 }),
  ]);
  const out = [];
  for (const c of complements) out.push({ icon: '⏰', titre: 'Complément échu', detail: `${c.candidature?.numeroDossier || 'Dossier'} — pièce « ${c.pieceDemandee} » attendue avant le ${c.echeance}`, lien: c.candidature?.documentId ? `/gestion/dossiers/${c.candidature.documentId}/completude` : '/gestion/dossiers' });
  for (const a of avances) out.push({ icon: '💳', titre: 'Avance non justifiée', detail: `${a.subvention?.candidature?.numeroDossier || 'Subvention'} — demande N°${String(a.numero || '').padStart(2, '0')}, nouveau décaissement bloqué (11.4)`, lien: a.subvention?.documentId ? `/gestion/subventions/${a.subvention.documentId}` : '/gestion/subventions' });
  for (const r of rapports) out.push({ icon: '📄', titre: 'Rapport échu', detail: `${r.subvention?.candidature?.numeroDossier || 'Subvention'} — ${r.type?.libelle || 'Rapport'} ${r.periodeLibelle || ''} non transmis`, lien: r.subvention?.documentId ? `/gestion/subventions/${r.subvention.documentId}` : '/gestion/subventions' });
  for (const m of mesures) out.push({ icon: '🛠️', titre: 'Mesure corrective ouverte', detail: `${m.subvention?.candidature?.numeroDossier || 'Subvention'} — ${m.description}`, lien: m.subvention?.documentId ? `/gestion/subventions/${m.subvention.documentId}?onglet=mesures` : '/gestion/subventions' });
  for (const j of jalons) out.push({ icon: '📅', titre: 'Jalon dépassé', detail: `${j.subvention?.candidature?.numeroDossier || 'Subvention'} — « ${j.etape?.libelle || 'jalon'} » prévu le ${j.datePrevue}, non réalisé`, lien: j.subvention?.documentId ? `/gestion/subventions/${j.subvention.documentId}?onglet=jalons` : '/gestion/subventions' });
  return out;
}

// Valeur d'un indicateur (K3). Les `calcule` ignorent les valeurs saisies.
async function indicateurValeur(strapi, ind, bag) {
  const { subventions, execution, dep, delais } = bag;
  const money = (n) => `${n.toLocaleString('fr-FR')} $`;
  switch (ind.code) {
    case 'res_infra_financees': return String(subventions.length);
    case 'res_projets_acheves': return String(subventions.filter((s) => s.statut === 'cloturee').length);
    case 'res_taux_execution': return `${pct(execution.decaisse, execution.engage)} %`;
    case 'res_invest_mobilises': return money(subventions.filter((s) => ['active', 'suspendue', 'cloturee'].includes(s.statut)).reduce((s, x) => s + toNum(x.montantContrepartie), 0));
    case 'imp_emplois_crees': return String(dep.empT);
    case 'imp_operateurs_benef': return String(new Set(subventions.map((s) => s.owner?.id).filter(Boolean)).size || subventions.length);
    case 'imp_beneficiaires': return String(dep.benef);
    case 'inc_part_femmes': return `${pct(dep.empF, dep.empT)} %`;
    case 'inc_projets_femmes': {
      const tot = subventions.length;
      const f = subventions.filter((s) => s.candidature?.donneesProjet?.impact?.porteParFemme === 'oui').length;
      return tot ? `${pct(f, tot)} %` : '—';
    }
    case 'inc_part_jeunes': return `${pct(dep.empJ, dep.empT)} %`;
    case 'inc_part_refugies': return `${pct(dep.empR, dep.empT)} %`;
    case 'fid_delai_paiement': return delais.paiement != null ? `${String(delais.paiement).replace('.', ',')} j` : '—';
    case 'fid_taux_rejet': {
      const rej = bag.demandes.filter((d) => d.statut?.code === 'rejetee').length;
      const dec = bag.demandes.filter((d) => ['payee', 'rejetee'].includes(d.statut?.code)).length;
      return `${pct(rej, dec)} %`;
    }
    case 'fid_irregularites': { const v = await saisieValeur(strapi, 'fid_irregularites'); return String(v ?? 0); }
    case 'es_conformite': return subventions.length ? '100 %' : '—';
    case 'es_plaintes': { const v = await saisieValeur(strapi, 'es_plaintes'); return String(v ?? 0); }
    case 'es_incidents': return String(dep.incidents);
    default: return ind.mode === 'saisi' ? String((await saisieValeur(strapi, ind.code)) ?? 0) : '—';
  }
}

function ecart(valeur, cible) {
  const pv = parseFloat(String(valeur).replace(/[^\d.,-]/g, '').replace(',', '.'));
  const pc = parseFloat(String(cible).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (isNaN(pv) || isNaN(pc) || !/%/.test(String(valeur)) || !/%/.test(String(cible))) return null;
  return pv >= pc ? 'ok' : 'ko';
}

async function uploadPdfBuffer(strapi, buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-se-${crypto.randomUUID()}.pdf`);
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
  // GET /gestion/se/tableau-de-bord
  async tableauDeBord(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const appel = appelFilter(ctx);
    const [subventions, demandes] = await Promise.all([loadSubventions(strapi, appel), loadDemandes(strapi, appel)]);
    const [entonnoir, delais, alertes] = await Promise.all([computeEntonnoir(strapi, appel), computeDelais(strapi, appel), computeAlertes(strapi, appel)]);
    ctx.body = { data: { entonnoir, execution: computeExecution(subventions, demandes), delais, alertes } };
  },

  // GET /gestion/se/indicateurs
  async indicateurs(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const appel = appelFilter(ctx);
    const [subventions, demandes, dep, delais, refs] = await Promise.all([
      loadSubventions(strapi, appel), loadDemandes(strapi, appel), validatedDepouillements(strapi, appel), computeDelais(strapi, appel),
      strapi.documents('api::indicateur.indicateur').findMany({ sort: 'ordre:asc', limit: 100 }),
    ]);
    const execution = computeExecution(subventions, demandes);
    const bag = { subventions, demandes, execution, dep, delais };
    const FAM = { resultats: 'Résultats (14.3.1)', impact: 'Impact (14.3.2)', inclusion: 'Inclusion (14.3.3)', fiduciaires: 'Fiduciaires (14.3.4)', es: 'Environnementaux & sociaux (14.3.5)' };
    const rows = [];
    for (const ind of refs) {
      const valeur = await indicateurValeur(strapi, ind, bag);
      rows.push({ code: ind.code, famille: ind.famille, familleLibelle: FAM[ind.famille] || ind.famille, libelle: ind.libelle, mode: ind.mode, unite: ind.unite || null, cible: ind.cible || '—', valeur, ecart: ecart(valeur, ind.cible || '') });
    }
    ctx.body = { data: rows };
  },

  // GET /gestion/se/depouillements
  async depouillements(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const appel = appelFilter(ctx);
    const filters = appel ? { rapportRequis: { subvention: { candidature: { appel: { documentId: appel } } } } } : {};
    const items = await strapi.documents('api::depouillement-rapport.depouillement-rapport').findMany({
      filters,
      populate: {
        saisiPar: { fields: ['orgName', 'username'] },
        rapportRequis: { fields: ['periodeLibelle', 'dateTransmission'], populate: { type: { fields: ['libelle'] }, fichier: { fields: ['url'] }, subvention: { fields: ['numeroConvention'], populate: { owner: { fields: ['orgName'] }, candidature: { fields: ['numeroDossier'] } } } } },
      },
      sort: 'createdAt:asc', limit: 500,
    });
    ctx.body = {
      data: items.map((d) => ({
        documentId: d.documentId,
        titre: `${d.rapportRequis?.type?.libelle || 'Rapport'}${d.rapportRequis?.periodeLibelle ? ` — ${d.rapportRequis.periodeLibelle}` : ''}`,
        operateur: d.rapportRequis?.subvention?.owner?.orgName || d.rapportRequis?.subvention?.candidature?.numeroDossier || '—',
        convention: d.rapportRequis?.subvention?.numeroConvention || null,
        dateTransmission: d.rapportRequis?.dateTransmission || null,
        fichierUrl: d.rapportRequis?.fichier?.url || null,
        statut: d.statut,
        saisiPar: d.saisiPar ? displayName(d.saisiPar) : null,
        valeurs: d.valeurs || { empT: '', empF: '', empJ: '', empR: '', benef: '', inv: '', incidents: 0, note: '' },
      })),
    };
  },

  // POST /gestion/se/depouillements/:documentId/proposer — Cabinet saisit + propose (14.6).
  async depouillementProposer(ctx) {
    const user = requireRole(ctx, ['instructeur', 'ugp']);
    if (!user) return;
    const d = await strapi.documents('api::depouillement-rapport.depouillement-rapport').findOne({ documentId: ctx.params.documentId, populate: { rapportRequis: { populate: { subvention: { populate: { candidature: { fields: ['documentId'] } } } } } } });
    if (!d) return ctx.notFound('Dépouillement introuvable.');
    if (d.statut === 'valide') return ctx.badRequest('Dépouillement déjà validé.');
    const v = ctx.request.body?.data?.valeurs || {};
    const num = (x) => Math.max(0, parseInt(x, 10) || 0);
    const valeurs = { empT: num(v.empT), empF: num(v.empF), empJ: num(v.empJ), empR: num(v.empR), benef: num(v.benef), inv: num(v.inv), incidents: num(v.incidents), note: String(v.note || '').trim() };
    await strapi.documents('api::depouillement-rapport.depouillement-rapport').update({ documentId: d.documentId, data: { valeurs, statut: 'propose', saisiPar: { connect: [user.id] }, proposeLe: new Date().toISOString() } });
    const cand = d.rapportRequis?.subvention?.candidature?.documentId || null;
    await journal(strapi, cand, { auteurUser: user, type: 'depouillement_propose', texte: `Dépouillement du rapport « ${d.rapportRequis?.periodeLibelle || ''} » proposé à la validation UGP` });
    ctx.body = { ok: true };
  },

  // POST /gestion/se/depouillements/:documentId/valider — UGP valide (integre aux indicateurs).
  async depouillementValider(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const d = await strapi.documents('api::depouillement-rapport.depouillement-rapport').findOne({ documentId: ctx.params.documentId, populate: { rapportRequis: { populate: { subvention: { populate: { candidature: { fields: ['documentId'] } } } } } } });
    if (!d) return ctx.notFound('Dépouillement introuvable.');
    if (d.statut !== 'propose') return ctx.badRequest('Seul un dépouillement proposé peut être validé.');
    await strapi.documents('api::depouillement-rapport.depouillement-rapport').update({ documentId: d.documentId, data: { statut: 'valide', validePar: { connect: [user.id] }, valideLe: new Date().toISOString() } });
    const cand = d.rapportRequis?.subvention?.candidature?.documentId || null;
    await journal(strapi, cand, { auteurUser: user, type: 'depouillement_valide', texte: `Dépouillement validé — les valeurs alimentent les indicateurs (impact, inclusion, E&S)` });
    ctx.body = { ok: true };
  },

  // POST /gestion/se/depouillements/:documentId/renvoyer — UGP renvoie au Cabinet.
  async depouillementRenvoyer(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const d = await strapi.documents('api::depouillement-rapport.depouillement-rapport').findOne({ documentId: ctx.params.documentId, populate: { rapportRequis: { populate: { subvention: { populate: { candidature: { fields: ['documentId'] } } } } } } });
    if (!d) return ctx.notFound('Dépouillement introuvable.');
    if (d.statut !== 'propose') return ctx.badRequest('Seul un dépouillement proposé peut être renvoyé.');
    await strapi.documents('api::depouillement-rapport.depouillement-rapport').update({ documentId: d.documentId, data: { statut: 'a_depouiller' } });
    const cand = d.rapportRequis?.subvention?.candidature?.documentId || null;
    await journal(strapi, cand, { auteurUser: user, type: 'depouillement_renvoye', texte: 'Dépouillement renvoyé au Cabinet' });
    ctx.body = { ok: true };
  },

  // GET /gestion/se/rapports — synthèses générées.
  async rapports(ctx) {
    if (!requireRole(ctx, ['instructeur', 'ugp'])) return;
    const items = await strapi.documents('api::rapport-synthese.rapport-synthese').findMany({ populate: { pdf: { fields: ['url', 'name'] }, generePar: { fields: ['orgName', 'username'] } }, sort: 'genereLe:desc', limit: 100 });
    ctx.body = { data: items.map((r) => ({ documentId: r.documentId, periode: r.periode, pdf: r.pdf?.url ? { url: r.pdf.url, name: r.pdf.name } : null, generePar: r.generePar ? displayName(r.generePar) : null, genereLe: r.genereLe || null })) };
  },

  // POST /gestion/se/rapports — génère un rapport de synthèse PDF (K4, UGP seul).
  async genererRapport(ctx) {
    const user = requireRole(ctx, ['ugp']);
    if (!user) return;
    const body = ctx.request.body?.data || {};
    const periode = String(body.periode || 'Période').trim();
    const cohorteLabel = String(body.cohorteLabel || 'Cohorte 1').trim();
    const appel = body.cohorte && body.cohorte !== 'toutes' ? String(body.cohorte) : null;

    const [subventions, demandes] = await Promise.all([loadSubventions(strapi, appel), loadDemandes(strapi, appel)]);
    const [entonnoir, delais, alertes, dep, refs] = await Promise.all([
      computeEntonnoir(strapi, appel), computeDelais(strapi, appel), computeAlertes(strapi, appel), validatedDepouillements(strapi, appel),
      strapi.documents('api::indicateur.indicateur').findMany({ sort: 'ordre:asc', limit: 100 }),
    ]);
    const execution = computeExecution(subventions, demandes);
    const bag = { subventions, demandes, execution, dep, delais };
    const FAM = { resultats: 'Resultats', impact: 'Impact', inclusion: 'Inclusion', fiduciaires: 'Fiduciaires', es: 'Environnementaux et sociaux' };
    const indicateurs = [];
    for (const ind of refs) indicateurs.push({ famille: FAM[ind.famille] || ind.famille, libelle: ind.libelle, valeur: await indicateurValeur(strapi, ind, bag), cible: ind.cible || '-' });

    const pdf = await buildSyntheseSePdf({ periode, cohorte: cohorteLabel, entonnoir, execution, delais, alertes, indicateurs });
    const file = await uploadPdfBuffer(strapi, pdf, `Synthese_SE_${cohorteLabel.replace(/\s+/g, '_')}_${periode.replace(/\s+/g, '_')}.pdf`);
    await strapi.documents('api::rapport-synthese.rapport-synthese').create({ data: { periode: `${periode} — ${cohorteLabel}`, appel: appel ? { connect: [appel] } : null, pdf: file?.id || null, generePar: { connect: [user.id] }, genereLe: new Date().toISOString() } });
    await journal(strapi, null, { auteurUser: user, type: 'synthese_se_generee', texte: `Rapport de synthese S&E genere (${periode} — ${cohorteLabel})` });
    ctx.body = { ok: true };
  },
};
