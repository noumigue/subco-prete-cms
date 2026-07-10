'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

const { CANONICAL_STATUS_ORDER } = require('./portal-status');
const { buildCandidaturePdf } = require('./portal-pdf');

const DEMO_EMAIL = 'demo-candidat@subco-prete.bi';
const DEMO_PASSWORD = 'SubcoDemo2026!';

// Donnees de projet de demo (alimentent le PDF permanent des dossiers de demo).
const DEMO_DONNEES = {
  etape: 4,
  eligibilite: [
    { libelle: 'Structure legalement constituee', confirme: true },
    { libelle: 'Conformite fiscale sans contentieux majeur', confirme: true },
    { libelle: 'Aucune activite exclue par le mecanisme', confirme: true },
    { libelle: 'Capacite de mobiliser une contrepartie d au moins 20 %', confirme: true },
    { libelle: "Aucun conflit d interet avec le projet ou l UGP", confirme: true },
  ],
  operateur: { nif: '4001234567', rc: 'RC/BTN/2023/1024', email: DEMO_EMAIL, telephone: '+257 79 00 00 01' },
  projet: {
    filiere: 'Fruits tropicaux',
    typeInfrastructure: 'Unite de sechage solaire de mangues d une capacite de 2 tonnes par jour, avec chambre de conditionnement et stockage ventile.',
    siteProvince: 'Butanyerera', siteCommune: 'Kayanza', memeSiege: true,
    statutSite: 'Propriete', usageCollectif: 'Oui', mpmeDesservies: '40', maturite: 'Semi-mature',
    noteConceptuelle: 'Le projet reduit les pertes post-recolte de mangues via une unite de sechage solaire mutualisee au benefice de 40 MPME et cooperatives de la zone.',
  },
  financement: { budgetTotal: 120000000, contrepartie: 24000000, typeContrepartie: 'Numeraire', modeleEconomique: 'Frais de service preleves sur les volumes seches.' },
  impact: { mpme: '40', femmes: '24', jeunes: '10', refugies: '8', emplois: '15', porteParFemme: 'Oui', zoneRurale: 'Oui' },
  es: { reponses: [{ libelle: 'Travaux ou construction', reponse: 'Oui' }, { libelle: 'Pollution, dechets ou nuisances', reponse: 'Non' }], risqueDeclare: true },
  pieces: [
    { libelle: "Attestation d'existence legale (RC / acte constitutif)", depose: true, nomFichier: 'rc.pdf' },
    { libelle: 'Etats financiers recents (3 exercices)', depose: true, nomFichier: 'etats.pdf' },
    { libelle: 'Note conceptuelle du projet', depose: true, nomFichier: 'note.pdf' },
  ],
};

// Genere + attache un PDF permanent a un dossier de demo (idempotent : seulement si absent).
async function ensureDemoPdf(strapi, candidatureDoc, organisation, appel) {
  const current = await strapi.documents('api::candidature.candidature').findOne({
    documentId: candidatureDoc.documentId,
    populate: ['pdfPermanent'],
  });
  if (current?.pdfPermanent) return;

  const buffer = await buildCandidaturePdf({
    candidature: { ...candidatureDoc, donneesProjet: DEMO_DONNEES },
    organisation,
    appel,
    mode: 'permanent',
  });

  const tmpPath = path.join(os.tmpdir(), `subco-demo-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: `${candidatureDoc.numeroDossier || 'dossier'}.pdf` } },
      files: { filepath: tmpPath, originalFilename: `${candidatureDoc.numeroDossier || 'dossier'}.pdf`, mimetype: 'application/pdf', size: buffer.length },
    });
    await strapi.documents('api::candidature.candidature').update({
      documentId: candidatureDoc.documentId,
      data: { pdfPermanent: uploaded?.id || null },
    });
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

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
    'api::categorie-assistance.categorie-assistance',
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
    // Assistance (canal bidirectionnel) — candidat ET beneficiaire (heritage).
    'api::demande-assistance.demande-assistance.find',
    'api::demande-assistance.demande-assistance.findOne',
    'api::demande-assistance.demande-assistance.create',
    'api::demande-assistance.demande-assistance.repondre',
    'api::demande-assistance.demande-assistance.resoudre',
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
    { nom: 'Butanyerera', code: 'BTN', anciensNoms: ['Ngozi', 'Kayanza', 'Kirundo'] },
    { nom: 'Burunga', code: 'BRG', anciensNoms: ['Bururi', 'Rumonge', 'Makamba', 'Rutana'] },
    { nom: 'Gitega', code: 'GIT', anciensNoms: ['Karuzi', 'Mwaro', 'Muramvya'] },
    { nom: 'Buhumuza', code: 'BHM', anciensNoms: ['Cankuzo', 'Ruyigi', 'Muyinga'] },
  ];

  const provinceDocs = {};

  for (const province of provinces) {
    provinceDocs[province.code] = await upsertDocument(strapi, 'api::province.province', { code: province.code }, province);
  }

  // 42 communes du decoupage 2025 (source : referentiel provinces/communes valide equipe).
  const communes = [
    // Buhumuza (7)
    ['Butaganzwa', 'BHM'], ['Butihinda', 'BHM'], ['Cankuzo', 'BHM'], ['Gisagara', 'BHM'],
    ['Gisuru', 'BHM'], ['Muyinga', 'BHM'], ['Ruyigi', 'BHM'],
    // Bujumbura (11)
    ['Bubanza', 'BJM'], ['Bukinanyana', 'BJM'], ['Cibitoke', 'BJM'], ['Isare', 'BJM'],
    ['Mpanda', 'BJM'], ['Mugere', 'BJM'], ['Mugina', 'BJM'], ['Muhuta', 'BJM'],
    ['Mukaza', 'BJM'], ['Ntahangwa', 'BJM'], ['Rwibaga', 'BJM'],
    // Burunga (7)
    ['Bururi', 'BRG'], ['Makamba', 'BRG'], ['Matana', 'BRG'], ['Musongati', 'BRG'],
    ['Nyanza', 'BRG'], ['Rumonge', 'BRG'], ['Rutana', 'BRG'],
    // Butanyerera (8)
    ['Busoni', 'BTN'], ['Kayanza', 'BTN'], ['Kiremba', 'BTN'], ['Kirundo', 'BTN'],
    ['Matongo', 'BTN'], ['Muhanga', 'BTN'], ['Ngozi', 'BTN'], ['Tangara', 'BTN'],
    // Gitega (9)
    ['Bugendana', 'GIT'], ['Gishubi', 'GIT'], ['Gitega', 'GIT'], ['Karusi', 'GIT'],
    ['Kiganda', 'GIT'], ['Muramvya', 'GIT'], ['Mwaro', 'GIT'], ['Nyabihanga', 'GIT'],
    ['Shombo', 'GIT'],
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

  // typePiece (Annexe 9) — liste reelle issue des maquettes validees + Module 3.
  // Nettoyage des anciens libelles semes (placeholders « (a confirmer UGP) » + libelles
  // heritees du scaffold), superseeds par la liste canonique ci-dessous. On ne touche
  // qu'a nos propres artefacts historiques (pas aux ajouts UGP eventuels).
  const LEGACY_PIECE_LIBELLES = [
    'Statuts ou acte constitutif',
    'Attestation fiscale recente',
    'Etats financiers',
    'Plan d affaires ou note technique',
  ];
  const stalePieces = await strapi.documents('api::type-piece.type-piece').findMany({
    filters: {
      $or: [
        { libelle: { $contains: '(a confirmer UGP)' } },
        { libelle: { $in: LEGACY_PIECE_LIBELLES } },
      ],
    },
    limit: 50,
  });
  for (const stale of stalePieces) {
    await strapi.documents('api::type-piece.type-piece').delete({ documentId: stale.documentId });
  }

  for (const row of [
    // Administratives
    { libelle: "Attestation d'existence legale (RC / acte constitutif)", groupe: 'administratif', exigence: 'obligatoire', ordre: 10 },
    { libelle: "Numero d'identification fiscale (NIF)", groupe: 'administratif', exigence: 'obligatoire', ordre: 20 },
    { libelle: 'Attestation de non-redevance fiscale', groupe: 'administratif', exigence: 'si_applicable', ordre: 30 },
    { libelle: "Declaration de conflit d'interet", groupe: 'administratif', exigence: 'obligatoire', ordre: 40 },
    // Financieres
    { libelle: 'Etats financiers recents (3 exercices)', groupe: 'financier', exigence: 'obligatoire', ordre: 50 },
    { libelle: 'Justificatif de mobilisation de la contrepartie', groupe: 'financier', exigence: 'obligatoire', ordre: 60 },
    { libelle: "Plan d'affaires / budget detaille", groupe: 'financier', exigence: 'obligatoire', ordre: 70 },
    // Techniques
    { libelle: 'Note conceptuelle du projet', groupe: 'technique', exigence: 'obligatoire', ordre: 80 },
    { libelle: 'Preuve de disponibilite du site', groupe: 'technique', exigence: 'obligatoire', ordre: 90 },
    { libelle: "Devis / plans d'infrastructure", groupe: 'technique', exigence: 'si_disponible', ordre: 100 },
    { libelle: 'Plan de gestion environnementale et sociale (PGES)', groupe: 'technique', exigence: 'si_applicable', ordre: 110 },
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

  // Categories d'assistance (referentiel A.2) — jamais en dur cote portail.
  for (const row of [
    { code: 'ma_candidature', libelle: 'Ma candidature', ordre: 10 },
    { code: 'ma_subvention', libelle: 'Ma subvention', ordre: 20 },
    { code: 'probleme_technique', libelle: 'Probleme technique', ordre: 30 },
    { code: 'autre', libelle: 'Autre', ordre: 40 },
  ]) {
    await upsertDocument(strapi, 'api::categorie-assistance.categorie-assistance', { code: row.code }, row);
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

  // PDF permanent des dossiers de demo « en instruction » et « non retenu »
  // (pour que « PDF du dossier » soit telechargeable en demo).
  await ensureDemoPdf(strapi, inProgress, organisation, appel);
  await ensureDemoPdf(strapi, rejected, organisation, appel);

  // Demandes d'assistance de demo.
  await ensureDemoAssistance(strapi, user, inProgress);
}

async function uploadDemoPieceImage(strapi, label) {
  // Petit PDF « capture » servant de piece jointe de demo (A4).
  const { buildCandidaturePdf } = require('./portal-pdf');
  const buffer = await buildCandidaturePdf({
    candidature: { titreProjet: label, donneesProjet: {} },
    organisation: { nom: 'Capture de demonstration' },
    appel: { nom: 'Assistance' },
    mode: 'brouillon',
  });
  const tmpPath = path.join(os.tmpdir(), `subco-att-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: 'capture.pdf' } },
      files: { filepath: tmpPath, originalFilename: 'capture.pdf', mimetype: 'application/pdf', size: buffer.length },
    });
    return uploaded?.id || null;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

async function ensureDemoAssistance(strapi, user, candidatureLiee) {
  const OBJET_EN_COURS = "Je n'arrive pas a joindre mon etat financier";
  const OBJET_RESOLUE = 'Comment modifier mon numero de telephone ?';

  const [catCandidature, catAutre] = await Promise.all([
    findOneBy(strapi, 'api::categorie-assistance.categorie-assistance', { code: 'ma_candidature' }),
    findOneBy(strapi, 'api::categorie-assistance.categorie-assistance', { code: 'autre' }),
  ]);

  // 1. Demande EN COURS (message operateur + piece, puis reponse equipe -> lifecycle en_cours + notif).
  if (!(await findOneBy(strapi, 'api::demande-assistance.demande-assistance', { objet: OBJET_EN_COURS }))) {
    const demande = await strapi.documents('api::demande-assistance.demande-assistance').create({
      data: {
        owner: user.id,
        objet: OBJET_EN_COURS,
        categorie: connectRelation(catCandidature),
        concerneCandidature: connectRelation(candidatureLiee),
        statut: 'ouverte',
        origine: 'operateur',
      },
    });
    const pieceId = await uploadDemoPieceImage(strapi, 'Capture ecran');
    await strapi.documents('api::message-assistance.message-assistance').create({
      data: {
        demande: connectRelation(demande),
        auteur: 'operateur',
        corps: "Quand je clique sur le slot « Etats financiers », rien ne se passe. J'ai essaye deux fois.",
        pieces: pieceId ? [pieceId] : undefined,
        envoyeLe: '2026-07-12T10:04:00.000Z',
      },
    });
    // Reponse equipe -> declenche le lifecycle (en_cours + notification).
    await strapi.documents('api::message-assistance.message-assistance').create({
      data: {
        demande: connectRelation(demande),
        auteur: 'equipe',
        corps: 'Bonjour, merci pour la capture. Depuis quel appareil vous connectez-vous ? En attendant, essayez depuis un autre navigateur.',
        envoyeLe: '2026-07-14T09:12:00.000Z',
      },
    });
  }

  // 2. Demande RESOLUE (resolue par l'operateur).
  if (!(await findOneBy(strapi, 'api::demande-assistance.demande-assistance', { objet: OBJET_RESOLUE }))) {
    const demande = await strapi.documents('api::demande-assistance.demande-assistance').create({
      data: { owner: user.id, objet: OBJET_RESOLUE, categorie: connectRelation(catAutre), statut: 'ouverte', origine: 'operateur' },
    });
    await strapi.documents('api::message-assistance.message-assistance').create({
      data: { demande: connectRelation(demande), auteur: 'operateur', corps: "J'ai change de numero, ou puis-je le mettre a jour pour recevoir les SMS ?", envoyeLe: '2026-07-06T15:40:00.000Z' },
    });
    await strapi.documents('api::message-assistance.message-assistance').create({
      data: { demande: connectRelation(demande), auteur: 'equipe', corps: 'Bonjour, rendez-vous dans « Mon compte » -> « Numero de notification (SMS) ». Enregistrez le nouveau numero.', envoyeLe: '2026-07-07T08:55:00.000Z' },
    });
    await strapi.documents('api::demande-assistance.demande-assistance').update({
      documentId: demande.documentId,
      data: { statut: 'resolue', resolueLe: '2026-07-08T09:00:00.000Z', resoluePar: 'operateur' },
    });
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
