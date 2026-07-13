'use strict';

// M5 phase 4 — Assistance cote equipe (§19, H1-H4).
// Versant interne du canal d'assistance (§13) : aucun nouveau content-type, on ouvre
// le cote « equipe » par des endpoints role-gated (jamais owner-scopes, garde = role).
// La transition « message equipe -> en_cours + notification operateur » vit dans le
// lifecycle de message-assistance : on cree le message via strapi.documents() et on
// NE re-notifie PAS (sauf creation H4, ou le lifecycle se tait volontairement).

const { journal, displayName } = require('../../../utils/portal-instruction');
const { sendPortalNotification } = require('../../../utils/portal-notify');

const UID_DEMANDE = 'api::demande-assistance.demande-assistance';
const UID_MESSAGE = 'api::message-assistance.message-assistance';
const EQUIPE_ROLES = ['instructeur', 'ugp']; // H2 — comite exclu.

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) {
    ctx.unauthorized('Authentification requise.');
    return null;
  }
  if (!roles.includes(roleType)) {
    ctx.forbidden("Action reservee a l'equipe du projet.");
    return null;
  }
  return user;
}

const DEMANDE_POPULATE = {
  owner: { fields: ['id', 'email', 'phone', 'orgName', 'username'] },
  categorie: { fields: ['code', 'libelle'] },
  concerneCandidature: { fields: ['documentId', 'numeroDossier', 'titreProjet'] },
  concerneSubvention: { fields: ['documentId', 'numeroConvention', 'statut'] },
  priseEnChargePar: { fields: ['id', 'orgName', 'username', 'email'] },
};

async function findDemande(strapi, documentId, withMessages = false) {
  return strapi.documents(UID_DEMANDE).findOne({
    documentId,
    populate: withMessages
      ? { ...DEMANDE_POPULATE, messages: { populate: { pieces: { fields: ['url', 'name'] } }, sort: 'envoyeLe:asc' } }
      : DEMANDE_POPULATE,
  });
}

function serializeRow(d) {
  const messages = Array.isArray(d.messages) ? d.messages : null;
  const dernier = messages && messages.length ? messages[messages.length - 1] : null;
  return {
    documentId: d.documentId,
    objet: d.objet,
    statut: d.statut || 'ouverte',
    origine: d.origine || 'operateur',
    operateur: displayName(d.owner),
    categorie: d.categorie ? { code: d.categorie.code, libelle: d.categorie.libelle } : null,
    concerneCandidature: d.concerneCandidature
      ? { documentId: d.concerneCandidature.documentId, numeroDossier: d.concerneCandidature.numeroDossier || null, titreProjet: d.concerneCandidature.titreProjet || null }
      : null,
    concerneSubvention: d.concerneSubvention
      ? { documentId: d.concerneSubvention.documentId, numeroConvention: d.concerneSubvention.numeroConvention || null }
      : null,
    priseEnChargePar: d.priseEnChargePar ? { id: d.priseEnChargePar.id, nom: displayName(d.priseEnChargePar) } : null,
    updatedAt: d.updatedAt || null,
    dernierAuteur: dernier?.auteur || null,
    dernierLe: dernier?.envoyeLe || null,
  };
}

function serializeDetail(d) {
  return {
    ...serializeRow(d),
    resolueLe: d.resolueLe || null,
    resoluePar: d.resoluePar || null,
    messages: (d.messages || []).map((m) => ({
      auteur: m.auteur || 'operateur',
      corps: m.corps || '',
      envoyeLe: m.envoyeLe || null,
      pieces: (m.pieces || []).map((p) => ({ url: p.url, name: p.name })),
    })),
  };
}

// Trace 8.1.1 : journal rattache au dossier si la demande concerne une candidature
// (acte-dossier accepte candidature null -> trace nominative meme sans dossier lie).
async function trace(strapi, demande, user, type, texte) {
  await journal(strapi, demande.concerneCandidature?.documentId || null, { auteurUser: user, type, texte });
}

module.exports = {
  // GET /gestion/assistance — file complete (toutes origines), role-gated.
  async demandes(ctx) {
    if (!requireRole(ctx, EQUIPE_ROLES)) return;
    const rows = await strapi.documents(UID_DEMANDE).findMany({
      populate: { ...DEMANDE_POPULATE, messages: { fields: ['auteur', 'envoyeLe'], sort: 'envoyeLe:asc' } },
      sort: 'updatedAt:desc',
      limit: 500,
    });
    ctx.body = { data: rows.map(serializeRow) };
  },

  // GET /gestion/assistance/:documentId — fil complet.
  async demande(ctx) {
    if (!requireRole(ctx, EQUIPE_ROLES)) return;
    const d = await findDemande(strapi, ctx.params.documentId, true);
    if (!d) return ctx.notFound('Demande introuvable.');
    ctx.body = { data: serializeDetail(d) };
  },

  // POST /gestion/assistance/:documentId/prendre — H1 : prise en charge nominative,
  // sans blocage (sert aussi de « reprendre » : n'importe quel membre autorise ecrase).
  async prendre(ctx) {
    const user = requireRole(ctx, EQUIPE_ROLES);
    if (!user) return;
    const d = await findDemande(strapi, ctx.params.documentId);
    if (!d) return ctx.notFound('Demande introuvable.');
    if (d.statut === 'resolue') return ctx.badRequest('Cette demande est close.');
    await strapi.documents(UID_DEMANDE).update({
      documentId: d.documentId,
      data: { priseEnChargePar: { connect: [user.id] } },
    });
    await trace(strapi, d, user, 'assistance_prise', `Demande d'assistance « ${d.objet} » prise en charge`);
    ctx.body = { ok: true };
  },

  // POST /gestion/assistance/:documentId/liberer — H1 : liberation.
  async liberer(ctx) {
    const user = requireRole(ctx, EQUIPE_ROLES);
    if (!user) return;
    const d = await findDemande(strapi, ctx.params.documentId);
    if (!d) return ctx.notFound('Demande introuvable.');
    await strapi.documents(UID_DEMANDE).update({
      documentId: d.documentId,
      data: { priseEnChargePar: null },
    });
    await trace(strapi, d, user, 'assistance_liberee', `Demande d'assistance « ${d.objet} » liberee`);
    ctx.body = { ok: true };
  },

  // POST /gestion/assistance/:documentId/repondre — reponse equipe.
  // Le lifecycle fait la transition ouverte->en_cours + la notification operateur ;
  // ici : verrou resolue (A1) + auto-attribution si non prise (A.3.1).
  async repondre(ctx) {
    const user = requireRole(ctx, EQUIPE_ROLES);
    if (!user) return;
    const d = await findDemande(strapi, ctx.params.documentId);
    if (!d) return ctx.notFound('Demande introuvable.');
    if (d.statut === 'resolue') return ctx.badRequest('Cette demande est close : elle ne peut pas etre rouverte.');

    const corps = String(ctx.request.body?.data?.corps || '').trim();
    if (!corps) return ctx.badRequest('Le message est requis.');
    const pieces = Array.isArray(ctx.request.body?.data?.pieces)
      ? ctx.request.body.data.pieces.filter((p) => Number.isInteger(p))
      : [];

    await strapi.documents(UID_MESSAGE).create({
      data: {
        demande: { connect: [d.documentId] },
        auteur: 'equipe',
        corps,
        pieces,
        envoyeLe: new Date().toISOString(),
      },
    });

    // Repondre a une demande non prise l'attribue a son auteur (H1).
    if (!d.priseEnChargePar) {
      await strapi.documents(UID_DEMANDE).update({
        documentId: d.documentId,
        data: { priseEnChargePar: { connect: [user.id] } },
      });
    }

    await trace(strapi, d, user, 'assistance_reponse', `Reponse de l'equipe sur la demande « ${d.objet} »`);
    ctx.body = { ok: true };
  },

  // POST /gestion/assistance/:documentId/resoudre — cloture equipe (A1, symetrique).
  async resoudre(ctx) {
    const user = requireRole(ctx, EQUIPE_ROLES);
    if (!user) return;
    const d = await findDemande(strapi, ctx.params.documentId);
    if (!d) return ctx.notFound('Demande introuvable.');
    if (d.statut === 'resolue') return ctx.badRequest('Cette demande est deja close.');
    await strapi.documents(UID_DEMANDE).update({
      documentId: d.documentId,
      data: { statut: 'resolue', resolueLe: new Date().toISOString(), resoluePar: 'equipe' },
    });
    await trace(strapi, d, user, 'assistance_resolue', `Demande d'assistance « ${d.objet} » marquee resolue par l'equipe`);
    ctx.body = { ok: true };
  },

  // GET /gestion/assistance/operateurs — comptes operateurs pour le formulaire H4.
  async operateurs(ctx) {
    if (!requireRole(ctx, EQUIPE_ROLES)) return;
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { role: { type: { $in: ['candidat', 'beneficiaire'] } } },
      populate: { role: true },
      orderBy: { orgName: 'asc' },
      limit: 200,
    });
    ctx.body = {
      data: users.map((u) => ({ id: u.id, nom: displayName(u), email: u.email, role: u.role?.type || 'candidat' })),
    };
  },

  // GET /gestion/assistance/operateurs/:userId/rattachements — candidatures & subventions
  // de l'operateur choisi (rattachement optionnel de la demande H4).
  async rattachements(ctx) {
    if (!requireRole(ctx, EQUIPE_ROLES)) return;
    const userId = Number(ctx.params.userId);
    if (!Number.isInteger(userId)) return ctx.badRequest('Operateur invalide.');
    const [candidatures, subventions] = await Promise.all([
      strapi.documents('api::candidature.candidature').findMany({
        filters: { owner: { id: userId } },
        fields: ['documentId', 'numeroDossier', 'titreProjet'],
        sort: 'updatedAt:desc',
        limit: 50,
      }),
      strapi.documents('api::subvention.subvention').findMany({
        filters: { owner: { id: userId } },
        fields: ['documentId', 'numeroConvention', 'statut'],
        sort: 'updatedAt:desc',
        limit: 50,
      }),
    ]);
    ctx.body = {
      data: {
        candidatures: candidatures.map((c) => ({
          documentId: c.documentId,
          numeroDossier: c.numeroDossier || null,
          titreProjet: c.titreProjet || '',
        })),
        subventions: subventions.map((s) => ({
          documentId: s.documentId,
          numeroConvention: s.numeroConvention || null,
          statut: s.statut || 'preparation',
        })),
      },
    };
  },

  // POST /gestion/assistance — H4 : creation au nom d'un operateur (origine: ugp).
  // La demande apparait dans l'espace Assistance de l'operateur (module §13, inchange).
  async creerPourOperateur(ctx) {
    const user = requireRole(ctx, EQUIPE_ROLES);
    if (!user) return;
    const body = ctx.request.body?.data || {};
    const operateurId = Number(body.operateurId);
    const objet = String(body.objet || '').trim();
    const corps = String(body.corps || '').trim();
    if (!Number.isInteger(operateurId)) return ctx.badRequest('Operateur requis.');
    if (!objet) return ctx.badRequest("L'objet est requis.");
    if (!corps) return ctx.badRequest('Le message initial est requis.');

    const operateur = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: operateurId },
      populate: { role: true },
    });
    if (!operateur || !['candidat', 'beneficiaire'].includes(operateur.role?.type)) {
      return ctx.badRequest('Operateur invalide.');
    }

    const data = {
      owner: { connect: [operateur.id] },
      objet,
      statut: 'en_cours', // une reponse equipe existe deja (le message initial).
      origine: 'ugp',
      priseEnChargePar: { connect: [user.id] },
    };
    if (body.categorie) data.categorie = { connect: [String(body.categorie)] };
    if (body.concerneCandidature) data.concerneCandidature = { connect: [String(body.concerneCandidature)] };
    if (body.concerneSubvention) data.concerneSubvention = { connect: [String(body.concerneSubvention)] };

    const demande = await strapi.documents(UID_DEMANDE).create({ data });

    // Message initial equipe — le lifecycle se tait (origine ugp + premier message).
    await strapi.documents(UID_MESSAGE).create({
      data: {
        demande: { connect: [demande.documentId] },
        auteur: 'equipe',
        corps,
        envoyeLe: new Date().toISOString(),
      },
    });

    // Notification dediee (prompt H4) — a la place de celle du lifecycle.
    await sendPortalNotification(strapi, {
      userId: operateur.id,
      email: operateur.email,
      telephone: operateur.phone,
      candidature: body.concerneCandidature ? { documentId: String(body.concerneCandidature) } : null,
      sujet: "Une demande d'assistance a ete ouverte pour vous",
      corps: `Suite a votre appel, l'equipe du projet a ouvert la demande « ${objet} ». Retrouvez-la dans votre espace Assistance pour y repondre.`,
    });

    await journal(strapi, body.concerneCandidature ? String(body.concerneCandidature) : null, {
      auteurUser: user,
      type: 'assistance_creee',
      texte: `Demande d'assistance ouverte au nom de ${displayName(operateur)} : « ${objet} » (origine equipe)`,
    });

    ctx.body = { ok: true, documentId: demande.documentId };
  },
};
