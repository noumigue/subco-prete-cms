'use strict';

// ============================================================================
// M7 — Administration (§3.9 confidentialite, §9.5 archives, §14.10 protection
// des acces / journal horodate). Surface minimale (principe directeur M7) :
//   L1  un DRAPEAU `adminComptes` (pas un 4e role) gouverne « Comptes internes »,
//       controle COTE SERVEUR (un ugp standard recoit 403).
//   L2  cycle de vie par INVITATION e-mail (aucun mot de passe transmis) ;
//       DESACTIVATION (`blocked`), jamais suppression (le journal reference ses
//       auteurs a vie) ; changement de role trace ; chaque acte journalise.
//   L3  vue TRANSVERSE du journal `acte-dossier` existant (pas un nouveau journal)
//       + export CSV (l'artefact remis aux auditeurs, hors plateforme).
//
// Aucun nouveau content-type : le journal est l'`acte-dossier` (type `administration`,
// sans candidature) ; l'invitation s'appuie sur le flux users-permissions (compte non
// confirme + token + e-mail « definir votre mot de passe » via le service d'envoi existant).
// ============================================================================

const crypto = require('crypto');
const { journal, displayName, authorLabel } = require('../../../utils/portal-instruction');
// Invitations internes : envoi via la mail platform unifiee.
const { sendTemplate } = require('../../../utils/mail/mail-service');

const INTERNAL_ROLES = ['instructeur', 'ugp', 'comite'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Politique de mot de passe minimale (L5) — provision de forme, valeur a confirmer UGP.
const MIN_PASSWORD_LENGTH = 8;

// --- gardes d'acces -----------------------------------------------------------
async function requireUgp(ctx) {
  const user = ctx.state?.user;
  if (!user?.role?.type) {
    ctx.unauthorized('Authentification requise.');
    return null;
  }
  if (user.role.type !== 'ugp') {
    ctx.forbidden("Action reservee a l'UGP.");
    return null;
  }
  return user;
}

// L1 — le drapeau `adminComptes` (pas le role) ouvre la gestion des comptes.
// Controle serveur : on relit le drapeau en base (jamais une confiance UI).
async function requireAdminComptes(ctx) {
  const user = ctx.state?.user;
  if (!user?.role?.type) {
    ctx.unauthorized('Authentification requise.');
    return null;
  }
  if (!INTERNAL_ROLES.includes(user.role.type)) {
    ctx.forbidden("Action reservee a l'equipe du projet.");
    return null;
  }
  const fresh = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: user.id } });
  if (!fresh?.adminComptes) {
    ctx.forbidden('Gestion des comptes reservee aux porteurs du drapeau adminComptes (L1).');
    return null;
  }
  return user;
}

// --- serialisation ------------------------------------------------------------
function statutCompte(u) {
  if (u.blocked) return 'desactive';
  if (!u.confirmed) return 'invitation';
  return 'actif';
}

function serializeCompte(u) {
  return {
    id: u.id,
    nom: u.orgName || u.username || u.email,
    email: u.email,
    role: u.role?.type || null,
    adminComptes: Boolean(u.adminComptes),
    statut: statutCompte(u),
  };
}

// Categorisation du journal transverse : le champ `type` porte des codes fins par
// module (proposition_completude, validation_eligibilite, avis_fiduciaire...). On les
// regroupe en familles lisibles (maquette) sans jamais figer la liste des codes.
function categoriser(type) {
  const t = String(type || '').toLowerCase();
  if (/(administration|compte|invitation|desactiv|reactiv|role|adminComptes)/i.test(t)) return { cat: 'adm', label: 'Administration' };
  if (/(assistance)/.test(t)) return { cat: 'assist', label: 'Assistance' };
  if (/(subvention|condition|decaiss|jalon|mesure|justif|signature|convention|suspen|acd)/.test(t)) return { cat: 'subv', label: 'Subvention' };
  if (/(comite|decision|publication|non_objection|nonobjection|rapport|seance|\bpv\b|accord)/.test(t)) return { cat: 'dec', label: 'Décision' };
  if (/(scoring|eval|consolidation|fiche|harmonis|troisieme|bareme)/.test(t)) return { cat: 'eval', label: 'Évaluation' };
  return { cat: 'instr', label: 'Instruction' };
}

function roleTag(u) {
  const type = u.auteur?.role?.type;
  if (type === 'ugp') return 'ugp';
  if (type === 'instructeur') return 'instructeur';
  if (type === 'comite') return 'comite';
  // Repli : extrait le tag « (UGP) » du libelle nominatif fige a l'ecriture.
  const m = /\(([^)]+)\)\s*$/.exec(u.auteurLibelle || '');
  return m ? m[1] : '';
}

function acteurNom(a) {
  if (a.auteur) return displayName(a.auteur);
  return String(a.auteurLibelle || 'Systeme').replace(/\s*\([^)]*\)\s*$/, '');
}

// Chargement + filtrage du journal (partage par la vue et l'export).
async function loadJournal(strapi, { periode, type, acteurId, dossier }) {
  const filters = {};
  if (periode === '30' || periode === '90') {
    const days = periode === '30' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    filters.date = { $gte: since };
  }
  if (acteurId) filters.auteur = { id: Number(acteurId) };

  const rows = await strapi.documents('api::acte-dossier.acte-dossier').findMany({
    filters,
    sort: ['date:desc', 'createdAt:desc'],
    populate: { auteur: { populate: ['role'] }, candidature: { fields: ['numeroDossier', 'titreProjet'] } },
    limit: 2000,
  });

  const dossierQ = String(dossier || '').trim().toLowerCase();
  return rows
    .map((a) => {
      const c = categoriser(a.type);
      return {
        date: a.date || a.createdAt,
        acteur: acteurNom(a),
        role: roleTag(a),
        cat: c.cat,
        typeLabel: c.label,
        acte: a.texte || '',
        reference: a.candidature?.numeroDossier || '—',
      };
    })
    .filter((r) => (type && type !== 'tous' ? r.cat === type : true))
    .filter((r) => (dossierQ ? r.reference.toLowerCase().includes(dossierQ) : true));
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = {
  // ===========================================================================
  // COMPTES INTERNES (L1/L2) — tous gated `adminComptes`, tous journalises.
  // ===========================================================================
  async comptes(ctx) {
    if (!(await requireAdminComptes(ctx))) return;
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { role: { type: { $in: INTERNAL_ROLES } } },
      populate: { role: true },
      orderBy: { createdAt: 'asc' },
    });
    ctx.body = { data: users.map(serializeCompte) };
  },

  // L2 — invitation : compte NON confirme + token + e-mail « definir votre mot de passe ».
  // Aucun mot de passe genere ni transmis (un secret aleatoire non communique verrouille
  // le compte jusqu'a la definition par l'invite).
  async inviter(ctx) {
    const admin = await requireAdminComptes(ctx);
    if (!admin) return;

    const body = ctx.request.body?.data || ctx.request.body || {};
    const nom = String(body.nom || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const roleType = String(body.role || '').trim();
    const adminComptes = Boolean(body.adminComptes);

    if (!nom) return ctx.badRequest('Le nom est requis.');
    if (!EMAIL_RE.test(email)) return ctx.badRequest('Adresse e-mail invalide.');
    if (!['instructeur', 'ugp', 'comite'].includes(roleType)) return ctx.badRequest('Role interne invalide.');

    const existing = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email } });
    if (existing) return ctx.badRequest('Un compte existe deja avec cette adresse.');

    const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: roleType } });
    if (!role) return ctx.badRequest('Role introuvable.');

    const token = crypto.randomBytes(32).toString('hex');
    const randomSecret = crypto.randomBytes(24).toString('hex'); // jamais communique
    const service = strapi.plugin('users-permissions').service('user');
    const created = await service.add({
      username: email,
      email,
      password: randomSecret,
      provider: 'local',
      confirmed: false,
      blocked: false,
      role: role.id,
      orgName: nom,
      adminComptes,
      resetPasswordToken: token,
    });

    await sendInvitation(strapi, { email, nom, token });
    await journal(strapi, null, {
      auteurUser: admin,
      type: 'administration',
      texte: `Invitation envoyee : ${nom} (${roleType}${adminComptes ? ', adminComptes' : ''}) — lien de definition du mot de passe`,
    });

    ctx.body = { ok: true, id: created.id };
  },

  async renvoyer(ctx) {
    const admin = await requireAdminComptes(ctx);
    if (!admin) return;
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(ctx.params.id) }, populate: { role: true } });
    if (!user) return ctx.notFound('Compte introuvable.');
    if (user.confirmed) return ctx.badRequest('Ce compte est deja actif — aucune invitation en attente.');

    const token = crypto.randomBytes(32).toString('hex');
    await strapi.db.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { resetPasswordToken: token } });
    await sendInvitation(strapi, { email: user.email, nom: user.orgName || user.email, token });
    await journal(strapi, null, { auteurUser: admin, type: 'administration', texte: `Invitation renvoyee : ${displayName(user)}` });
    ctx.body = { ok: true };
  },

  async desactiver(ctx) {
    const admin = await requireAdminComptes(ctx);
    if (!admin) return;
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(ctx.params.id) }, populate: { role: true } });
    if (!user) return ctx.notFound('Compte introuvable.');
    if (!INTERNAL_ROLES.includes(user.role?.type)) return ctx.badRequest('Compte non interne.');
    if (user.id === admin.id) return ctx.badRequest('Vous ne pouvez pas desactiver votre propre compte.');

    await strapi.db.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { blocked: true } });
    await journal(strapi, null, { auteurUser: admin, type: 'administration', texte: `Compte desactive : ${displayName(user)} (connexion bloquee, historique conserve)` });
    ctx.body = { ok: true };
  },

  async reactiver(ctx) {
    const admin = await requireAdminComptes(ctx);
    if (!admin) return;
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(ctx.params.id) }, populate: { role: true } });
    if (!user) return ctx.notFound('Compte introuvable.');
    await strapi.db.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { blocked: false } });
    await journal(strapi, null, { auteurUser: admin, type: 'administration', texte: `Compte reactive : ${displayName(user)}` });
    ctx.body = { ok: true };
  },

  async changerRole(ctx) {
    const admin = await requireAdminComptes(ctx);
    if (!admin) return;
    const roleType = String((ctx.request.body?.data || ctx.request.body || {}).role || '').trim();
    if (!['instructeur', 'ugp', 'comite'].includes(roleType)) return ctx.badRequest('Role interne invalide.');

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: Number(ctx.params.id) }, populate: { role: true } });
    if (!user) return ctx.notFound('Compte introuvable.');
    const ancien = user.role?.type || '—';
    if (ancien === roleType) return ctx.badRequest('Ce compte a deja ce role.');

    const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: roleType } });
    await strapi.db.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { role: role.id } });
    await journal(strapi, null, { auteurUser: admin, type: 'administration', texte: `Role modifie : ${displayName(user)} — ${ancien} → ${roleType}` });
    ctx.body = { ok: true };
  },

  // ===========================================================================
  // JOURNAL TRANSVERSE (L3) — tout `ugp` ; lecture seule ; filtres + pagination.
  // ===========================================================================
  async journal(ctx) {
    if (!(await requireUgp(ctx))) return;
    const { periode, type, acteur, dossier, page, pageSize } = ctx.query || {};
    const all = await loadJournal(strapi, { periode, type, acteurId: acteur, dossier });

    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(10, Number(pageSize) || 25));
    const start = (p - 1) * size;
    ctx.body = {
      data: all.slice(start, start + size),
      meta: { total: all.length, page: p, pageSize: size },
      // Liste des acteurs internes pour le filtre (nom + id).
      acteurs: (await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { role: { type: { $in: INTERNAL_ROLES } } }, populate: { role: true }, orderBy: { orgName: 'asc' },
      })).map((u) => ({ id: u.id, nom: displayName(u) })),
    };
  },

  // L3 — export CSV genere COTE SERVEUR (memes filtres) : l'artefact remis aux
  // auditeurs et a la supervision (§9.5, §14.10), transmission hors plateforme.
  async journalExport(ctx) {
    if (!(await requireUgp(ctx))) return;
    const { periode, type, acteur, dossier } = ctx.query || {};
    const rows = await loadJournal(strapi, { periode, type, acteurId: acteur, dossier });

    const header = ['date_heure_iso', 'acteur', 'role', 'type', 'acte', 'reference'];
    const lines = [header.join(';')].concat(
      rows.map((r) => [r.date, r.acteur, r.role, r.typeLabel, r.acte, r.reference].map(csvCell).join(';')),
    );
    // BOM UTF-8 pour Excel (accents).
    ctx.set('Content-Type', 'text/csv; charset=utf-8');
    ctx.set('Content-Disposition', 'attachment; filename="journal-actes.csv"');
    ctx.body = '﻿' + lines.join('\r\n') + '\r\n';
  },

  // ===========================================================================
  // INVITATION — endpoints PUBLICS (garde par token), hors session.
  // ===========================================================================
  async verifierInvitation(ctx) {
    const token = String(ctx.query?.token || '').trim();
    if (!token) return ctx.badRequest('Jeton manquant.');
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { resetPasswordToken: token } });
    if (!user) return ctx.notFound('Lien invalide ou expire.');
    ctx.body = { email: user.email, nom: user.orgName || user.email, deja: Boolean(user.confirmed) };
  },

  // L2 — le lien DEFINIT le mot de passe ET confirme le compte (criteria M7).
  async definirMotDePasse(ctx) {
    const body = ctx.request.body?.data || ctx.request.body || {};
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token) return ctx.badRequest('Jeton manquant.');
    if (password.length < MIN_PASSWORD_LENGTH) return ctx.badRequest(`Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caracteres.`);

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { resetPasswordToken: token }, populate: { role: true } });
    if (!user) return ctx.badRequest('Lien invalide ou expire.');

    const service = strapi.plugin('users-permissions').service('user');
    await service.edit(user.id, { password, confirmed: true, blocked: false, resetPasswordToken: null });
    await journal(strapi, null, { auteurUser: user, type: 'administration', texte: `Compte active : ${displayName(user)} (mot de passe defini)` });
    ctx.body = { ok: true, email: user.email };
  },
};

// Envoi de l'invitation : lien vers la page « definir mon mot de passe » du portail
// de gestion. Si SMTP non configure (dev), on trace le lien dans les logs.
async function sendInvitation(strapi, { email, nom, token }) {
  const base = (process.env.PORTAL_PUBLIC_URL || process.env.PORTAL_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const link = `${base}/gestion/definir-mot-de-passe?token=${token}`;
  try {
    // Mail platform unifiee : template `auth.account_invitation` (rendu + journal).
    await sendTemplate('auth.account_invitation', { nom: nom || email, invitationUrl: link }, email, {
      meta: { flow: 'internal-invitation' },
    });
  } catch (error) {
    strapi.log.warn(`[gestion-admin] Echec e-mail d'invitation : ${error.message}`);
  }
}
