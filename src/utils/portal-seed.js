'use strict';

const { CANONICAL_STATUS_ORDER } = require('./portal-status');

const DEMO_EMAIL = 'demo-candidat@subco-prete.bi';
const DEMO_PASSWORD = 'SubcoDemo2026!';

async function findOneBy(strapi, uid, where) {
  const items = await strapi.documents(uid).findMany({ filters: where, limit: 1 });
  return items[0] || null;
}

async function upsertDocument(strapi, uid, where, data) {
  const existing = await findOneBy(strapi, uid, where);

  if (existing?.documentId) {
    return strapi.documents(uid).update({
      documentId: existing.documentId,
      data,
      status: 'published',
    });
  }

  return strapi.documents(uid).create({
    data,
    status: 'published',
  });
}

function connectRelation(document) {
  if (!document?.documentId) return null;
  return { connect: [document.documentId] };
}

async function ensureRole(strapi, type, name) {
  const existing = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type },
  });

  if (existing) {
    if (existing.name !== name) {
      await strapi.db.query('plugin::users-permissions.role').update({
        where: { id: existing.id },
        data: { name },
      });
    }
    return existing;
  }

  return strapi.db.query('plugin::users-permissions.role').create({
    data: {
      name,
      description: `Role ${name}`,
      type,
    },
  });
}

async function setPermission(strapi, roleId, action, enabled) {
  const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
    where: { role: roleId, action },
  });

  if (existing) {
    return strapi.db.query('plugin::users-permissions.permission').update({
      where: { id: existing.id },
      data: { enabled },
    });
  }

  return strapi.db.query('plugin::users-permissions.permission').create({
    data: { role: roleId, action, enabled },
  });
}

async function ensurePortalRolesAndSettings(strapi) {
  const publicRole = await ensureRole(strapi, 'public', 'Public');
  const authenticatedRole = await ensureRole(strapi, 'authenticated', 'Authenticated');
  const candidateRole = await ensureRole(strapi, 'candidat', 'Candidat');
  const beneficiaireRole = await ensureRole(strapi, 'beneficiaire', 'Beneficiaire');
  await ensureRole(strapi, 'instructeur', 'Instructeur');
  await ensureRole(strapi, 'ugp', 'UGP');
  await ensureRole(strapi, 'comite', 'Comite');
  await ensureRole(strapi, 'banque', 'Banque');

  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
    key: 'advanced',
  });

  const advancedSettings = (await pluginStore.get()) || {};

  await pluginStore.set({
    value: {
      ...advancedSettings,
      allow_register: true,
      email_confirmation: true,
      unique_email: true,
      default_role: 'candidat',
    },
  });

  const publicReadUids = [
    'api::homepage.homepage',
    'api::site-navigation.site-navigation',
    'api::about-page.about-page',
    'api::candidature-guide.candidature-guide',
    'api::infrastructure-band.infrastructure-band',
    'api::infrastructure-type.infrastructure-type',
    'api::footer-link.footer-link',
    'api::value-chain.value-chain',
    'api::call-for-proposal.call-for-proposal',
    'api::event.event',
    'api::news.news',
    'api::success-story.success-story',
    'api::resource-document.resource-document',
    'api::faq.faq',
    'api::faq-item.faq-item',
    'api::partner.partner',
    'api::etape-programme.etape-programme',
    'api::appel.appel',
    'api::filiere.filiere',
    'api::province.province',
    'api::commune.commune',
    'api::statut-juridique.statut-juridique',
    'api::type-contrepartie.type-contrepartie',
    'api::type-piece.type-piece',
    'api::statut-candidature.statut-candidature',
    'api::contenu-aide.contenu-aide',
    'api::faq-entree.faq-entree',
    'api::document-telechargeable.document-telechargeable',
    'api::modalite-decaissement.modalite-decaissement',
    'api::type-rapport.type-rapport',
    'api::etape-contractuelle.etape-contractuelle',
    'api::statut-demande.statut-demande',
  ];

  for (const uid of publicReadUids) {
    await setPermission(strapi, publicRole.id, `${uid}.find`, true);
    await setPermission(strapi, publicRole.id, `${uid}.findOne`, true);
  }

  const publicAuthActions = [
    'plugin::users-permissions.auth.callback',
    'plugin::users-permissions.auth.register',
    'plugin::users-permissions.auth.forgotPassword',
    'plugin::users-permissions.auth.resetPassword',
    'plugin::users-permissions.auth.emailConfirmation',
    'plugin::users-permissions.auth.sendEmailConfirmation',
  ];

  for (const action of publicAuthActions) {
    await setPermission(strapi, publicRole.id, action, true);
  }

  // Le public peut déposer une réclamation / un recours (page publique /reclamations,
  // option anonyme). Lecture réservée à l'UGP côté admin.
  const publicWriteActions = [
    'api::complaint-recourse.complaint-recourse.create',
  ];

  for (const action of publicWriteActions) {
    await setPermission(strapi, publicRole.id, action, true);
  }

  const candidateActions = [
    'api::organisation.organisation.find',
    'api::organisation.organisation.findOne',
    'api::organisation.organisation.create',
    'api::organisation.organisation.update',
    'api::candidature.candidature.find',
    'api::candidature.candidature.findOne',
    'api::candidature.candidature.create',
    'api::candidature.candidature.update',
    'api::candidature.candidature.delete',
    'api::candidature.candidature.soumettre',
    'api::candidature.candidature.pdfBrouillon',
    'api::portal-compte.portal-compte.moi',
    'api::portal-compte.portal-compte.updateTelephone',
    'api::portal-compte.portal-compte.requestEmailChange',
    'api::notification.notification.find',
    'api::notification.notification.findOne',
    'api::notification.notification.update',
    'api::notification.notification.toutMarquerLu',
    'api::complement.complement.find',
    'api::complement.complement.findOne',
    'api::complement.complement.create',
    'api::complement.complement.update',
    // « Ma subvention » en PREPARATION : le candidat lit sa subvention et depose sur
    // une condition `action_requise` (le role reste candidat jusqu'a la signature).
    'api::subvention.subvention.find',
    'api::subvention.subvention.findOne',
    'api::condition-prealable.condition-prealable.deposer',
    'plugin::upload.content-api.upload',
    'plugin::users-permissions.user.me',
  ];

  // Hygiene des permissions (remediation 1.8) : les permissions portail vivent sur `candidat`
  // (et `beneficiaire`), jamais sur `authenticated`. Un user `authenticated` brut
  // ne doit atteindre aucune collection transactionnelle.
  for (const action of candidateActions) {
    await setPermission(strapi, candidateRole.id, action, true);
  }

  // Le beneficiaire conserve les acces du candidat (il navigue le meme portail)
  // + les droits « Ma subvention » (Lot 2), en ecriture strictement limitee aux depots.
  const beneficiaireActions = [
    ...candidateActions,
    'api::demande-decaissement.demande-decaissement.find',
    'api::demande-decaissement.demande-decaissement.create',
    'api::demande-decaissement.demande-decaissement.update',
    'api::demande-decaissement.demande-decaissement.soumettre',
    'api::demande-decaissement.demande-decaissement.justifier',
    'api::rapport-requis.rapport-requis.deposer',
    'api::mesure-corrective.mesure-corrective.deposer',
  ];
  for (const action of beneficiaireActions) {
    await setPermission(strapi, beneficiaireRole.id, action, true);
  }

  // Nettoyage defensif : si une passe anterieure a copie les permissions sur `authenticated`,
  // on les desactive explicitement (idempotent).
  for (const action of candidateActions) {
    await setPermission(strapi, authenticatedRole.id, action, false);
  }

  return {
    candidateRole,
  };
}

async function ensureReferentials(strapi) {
  // Un appel OUVERT (cloture future) pour tester les CTA, + un appel A_VENIR pour tester le bandeau
  // d'information (remediation 1.2). Seul `ouvert` est candidatable cote serveur.
  const cohort = await upsertDocument(strapi, 'api::appel.appel', { codeCohorte: 'C1' }, {
    nom: 'Appel a propositions - Cohorte 1',
    codeCohorte: 'C1',
    ouvertLe: '2026-07-01',
    clotureLe: '2026-12-31',
    statut: 'ouvert',
  });

  await upsertDocument(strapi, 'api::appel.appel', { codeCohorte: 'C2' }, {
    nom: 'Appel a propositions - Cohorte 2',
    codeCohorte: 'C2',
    ouvertLe: '2027-01-15',
    clotureLe: '2027-03-15',
    statut: 'a_venir',
  });

  const filieres = [
    { nom: 'Fruits tropicaux', slug: 'fruits-tropicaux', transversal: false },
    { nom: 'Lait', slug: 'lait', transversal: false },
    { nom: 'Volaille', slug: 'volaille', transversal: false },
    { nom: 'Pisciculture', slug: 'pisciculture', transversal: false },
    { nom: 'Industrie miniere', slug: 'industrie-miniere', transversal: false },
    { nom: 'Projet transversal', slug: 'projet-transversal', transversal: true },
  ];

  for (const filiere of filieres) {
    await upsertDocument(strapi, 'api::filiere.filiere', { slug: filiere.slug }, filiere);
  }

  // 5 provinces du decoupage actuel + table de remap (`anciensNoms`) editable au CMS (remediation 1.4).
  // Toute valeur de l'ancien decoupage lue cote portail est remappee vers la province actuelle,
  // jamais reinjectee telle quelle a l'ecriture. Rattachements « a confirmer UGP ».
  const provinces = [
    { nom: 'Bujumbura', code: 'BJM', anciensNoms: ['Bujumbura Mairie', 'Bujumbura Rural', 'Bubanza', 'Cibitoke'] },
    { nom: 'Butanyerera', code: 'BTN', anciensNoms: ['Ngozi', 'Kayanza', 'Kirundo', 'Muyinga'] },
    { nom: 'Burunga', code: 'BRG', anciensNoms: ['Bururi', 'Rumonge', 'Makamba', 'Rutana'] },
    { nom: 'Gitega', code: 'GIT', anciensNoms: ['Karuzi', 'Mwaro', 'Muramvya'] },
    { nom: 'Buhumuza', code: 'BHM', anciensNoms: ['Cankuzo', 'Ruyigi'] },
  ];

  const provinceDocs = {};

  for (const province of provinces) {
    provinceDocs[province.code] = await upsertDocument(strapi, 'api::province.province', { code: province.code }, province);
  }

  const communes = [
    ['Mukaza', 'BJM'],
    ['Ntahangwa', 'BJM'],
    ['Kayanza', 'BTN'],
    ['Ngozi', 'BTN'],
    ['Rumonge', 'BRG'],
    ['Makamba', 'BRG'],
    ['Gitega', 'GIT'],
    ['Muramvya', 'GIT'],
    ['Muyinga', 'BHM'],
    ['Ruyigi', 'BHM'],
  ];

  for (const [nom, provinceCode] of communes) {
    await upsertDocument(strapi, 'api::commune.commune', { nom }, {
      nom,
      province: connectRelation(provinceDocs[provinceCode]),
    });
  }

  for (const row of [
    { libelle: 'Cooperative', ordre: 10 },
    { libelle: 'Association', ordre: 20 },
    { libelle: 'ONG', ordre: 30 },
    { libelle: 'PME', ordre: 40 },
  ]) {
    await upsertDocument(strapi, 'api::statut-juridique.statut-juridique', { libelle: row.libelle }, row);
  }

  for (const row of [
    { libelle: 'Numeraire', ordre: 10 },
    { libelle: 'Nature', ordre: 20 },
    { libelle: 'Mixte', ordre: 30 },
  ]) {
    await upsertDocument(strapi, 'api::type-contrepartie.type-contrepartie', { libelle: row.libelle }, row);
  }

  // typePiece (Annexe 9) — remediation 2.6 : couvrir les 3 groupes x 3 niveaux d'exigence
  // en PLACEHOLDERS (sans inventer les 18 libelles reels ni les 42 communes : « a confirmer UGP »).
  for (const row of [
    { libelle: 'Statuts ou acte constitutif', groupe: 'administratif', exigence: 'obligatoire', ordre: 10 },
    { libelle: 'Attestation fiscale recente', groupe: 'administratif', exigence: 'si_applicable', ordre: 20 },
    { libelle: 'Piece administrative complementaire (a confirmer UGP)', groupe: 'administratif', exigence: 'si_disponible', ordre: 30 },
    { libelle: 'Etats financiers', groupe: 'financier', exigence: 'obligatoire', ordre: 40 },
    { libelle: 'Justificatif de contrepartie (a confirmer UGP)', groupe: 'financier', exigence: 'si_applicable', ordre: 50 },
    { libelle: 'Piece financiere complementaire (a confirmer UGP)', groupe: 'financier', exigence: 'si_disponible', ordre: 60 },
    { libelle: 'Plan d affaires ou note technique', groupe: 'technique', exigence: 'obligatoire', ordre: 70 },
    { libelle: 'Devis ou plans d infrastructure (a confirmer UGP)', groupe: 'technique', exigence: 'si_applicable', ordre: 80 },
    { libelle: 'Piece technique complementaire (a confirmer UGP)', groupe: 'technique', exigence: 'si_disponible', ordre: 90 },
  ]) {
    await upsertDocument(strapi, 'api::type-piece.type-piece', { libelle: row.libelle }, row);
  }

  for (const row of CANONICAL_STATUS_ORDER) {
    await upsertDocument(strapi, 'api::statut-candidature.statut-candidature', { code: row.code }, row);
  }

  // Exemples de types d'infrastructure (3.1.3) : contenu editorial, JAMAIS une liste imposee.
  // Un item de liste = une ligne du panneau « (i) exemples » du formulaire.
  await upsertDocument(strapi, 'api::contenu-aide.contenu-aide', { cle: 'exemples-infrastructure' }, {
    cle: 'exemples-infrastructure',
    titre: "Exemples d'infrastructures eligibles",
    corps: [
      {
        type: 'list',
        format: 'unordered',
        children: [
          'Unite de transformation ou atelier',
          'Entrepot, chambre froide ou chaine du froid',
          'Centre de collecte, distribution ou logistique',
          'Laboratoire ou dispositif de controle qualite',
          'Plateforme numerique ou application de mise en relation',
          'Infrastructure immaterielle ou systeme de gestion',
        ].map((text) => ({
          type: 'list-item',
          children: [{ type: 'text', text }],
        })),
      },
    ],
  });

  // FAQ (Lot 1) — reference publique, editable au CMS.
  for (const row of [
    {
      question: "Qu'est-ce que la contrepartie de 20 % ?",
      ordre: 10,
      reponse: 'Votre organisation doit financer au moins 20 % du budget de son projet ; la subvention couvre le reste, dans la limite du plafond de la cohorte.',
    },
    {
      question: 'Quand mon numero de dossier est-il attribue ?',
      ordre: 20,
      reponse: "A la soumission de votre candidature. Un brouillon n'a pas de numero.",
    },
    {
      question: "Que faire si l'UGP me demande une piece complementaire ?",
      ordre: 30,
      reponse: 'Vous la deposez depuis la page de suivi de votre dossier, avant l\'echeance indiquee. Ce depot s\'ajoute au dossier sans le modifier.',
    },
  ]) {
    await upsertDocument(strapi, 'api::faq-entree.faq-entree', { question: row.question }, {
      question: row.question,
      ordre: row.ordre,
      reponse: [{ type: 'paragraph', children: [{ type: 'text', text: row.reponse }] }],
    });
  }

  // Documents a telecharger (Lot 1) — le fichier media est ajoute au CMS par l'UGP.
  for (const row of [
    { titre: 'Guide du candidat', ordre: 10 },
    { titre: 'Notice de la note conceptuelle', ordre: 20 },
  ]) {
    await upsertDocument(strapi, 'api::document-telechargeable.document-telechargeable', { titre: row.titre }, row);
  }

  return { cohort };
}

async function ensureDemoPortalData(strapi, candidateRole) {
  const candidateService = strapi.plugin('users-permissions').service('user');
  let user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: DEMO_EMAIL },
    populate: ['role'],
  });

  if (!user) {
    user = await candidateService.add({
      username: DEMO_EMAIL,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      confirmed: true,
      blocked: false,
      provider: 'local',
      role: candidateRole.id,
      // orgName persiste sur le compte (remediation 1.1) — la salutation ne repose jamais sur l'e-mail.
      orgName: 'Cooperative Girumwete',
    });
  } else if (!user.confirmed || user.role?.type !== 'candidat' || !user.orgName) {
    user = await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { confirmed: true, blocked: false, role: candidateRole.id, orgName: user.orgName || 'Cooperative Girumwete' },
      populate: ['role'],
    });
  }

  const [appel, statutBrouillon, statutSoumis, statutNonRetenu, cooperative, province, commune, filiere] = await Promise.all([
    findOneBy(strapi, 'api::appel.appel', { codeCohorte: 'C1' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'brouillon' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'soumis' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'non_retenu' }),
    findOneBy(strapi, 'api::statut-juridique.statut-juridique', { libelle: 'Cooperative' }),
    findOneBy(strapi, 'api::province.province', { code: 'BTN' }),
    findOneBy(strapi, 'api::commune.commune', { nom: 'Kayanza' }),
    findOneBy(strapi, 'api::filiere.filiere', { slug: 'fruits-tropicaux' }),
  ]);

  const organisation = await upsertDocument(strapi, 'api::organisation.organisation', { nom: 'Cooperative Girumwete' }, {
    owner: user.id,
    nom: 'Cooperative Girumwete',
    statutJuridique: connectRelation(cooperative),
    filierePrincipale: connectRelation(filiere),
    province: connectRelation(province),
    commune: connectRelation(commune),
    adresse: 'Zone Kayanza, Burundi',
    telephone: '+257 79 00 00 01',
    contact: 'Contact principal demo',
  });

  const draft = await upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: 'Sechage solaire de mangues' }, {
    owner: user.id,
    appel: connectRelation(appel),
    organisation: connectRelation(organisation),
    titreProjet: 'Sechage solaire de mangues',
    statut: connectRelation(statutBrouillon),
    numeroDossier: null,
    dateDepot: null,
    donneesProjet: { step: 'montage-module-3', note: 'Brouillon cree pour le scaffold.' },
    motifDecisionCourt: null,
  });

  const inProgress = await upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: 'Unite de sechage de mangues' }, {
    owner: user.id,
    appel: connectRelation(appel),
    organisation: connectRelation(organisation),
    titreProjet: 'Unite de sechage de mangues',
    statut: connectRelation(statutSoumis),
    numeroDossier: 'PRETE-AP-C1-2026-00042',
    dateDepot: '2026-07-12T09:00:00.000Z',
    donneesProjet: { stub: true },
    motifDecisionCourt: null,
  });

  const rejected = await upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: 'Mini laiterie cooperative' }, {
    owner: user.id,
    appel: connectRelation(appel),
    organisation: connectRelation(organisation),
    titreProjet: 'Mini laiterie cooperative',
    statut: connectRelation(statutNonRetenu),
    numeroDossier: 'PRETE-AP-C1-2026-00017',
    dateDepot: '2026-05-02T09:00:00.000Z',
    donneesProjet: { stub: true },
    motifDecisionCourt: "Projet pertinent mais dossier incomplet au stade de l'evaluation finale.",
  });

  await upsertDocument(strapi, 'api::complement.complement', { pieceDemandee: 'Attestation fiscale recente' }, {
    candidature: connectRelation(inProgress),
    pieceDemandee: 'Attestation fiscale recente',
    echeance: '2026-07-18',
    statut: 'demande',
  });

  for (const row of [
    {
      owner: user.id,
      candidature: connectRelation(inProgress),
      canal: 'email',
      sujet: 'Accuse de reception',
      corps: 'Votre dossier a ete recu et passe en evaluation.',
      envoyeLe: '2026-07-12T09:10:00.000Z',
      lu: false,
    },
    {
      owner: user.id,
      candidature: connectRelation(inProgress),
      canal: 'sms',
      sujet: 'Complement demande',
      corps: 'Merci de deposer votre attestation fiscale avant la date limite.',
      envoyeLe: '2026-07-14T12:00:00.000Z',
      lu: false,
    },
    {
      owner: user.id,
      candidature: connectRelation(rejected),
      canal: 'email',
      sujet: 'Decision de non-selection',
      corps: 'La cohorte 1 est cloturee. Votre projet reste eligible a une prochaine cohorte.',
      envoyeLe: '2026-06-20T10:00:00.000Z',
      lu: true,
    },
    {
      // Notification globale (non rattachee a un dossier) — lue.
      owner: user.id,
      candidature: null,
      canal: 'email',
      sujet: 'Bienvenue sur SUBCO-PRETE',
      corps: 'Votre compte est actif. Vous pouvez preparer votre premiere candidature des qu\'un appel est ouvert.',
      envoyeLe: '2026-07-02T08:00:00.000Z',
      lu: true,
    },
  ]) {
    await upsertDocument(strapi, 'api::notification.notification', { sujet: row.sujet, envoyeLe: row.envoyeLe }, row);
  }
}

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  ensureDemoPortalData,
  ensurePortalRolesAndSettings,
  ensureReferentials,
  setPermission,
};
