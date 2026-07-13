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
  const instructeurRole = await ensureRole(strapi, 'instructeur', 'Instructeur');
  const ugpRole = await ensureRole(strapi, 'ugp', 'UGP');
  const comiteRole = await ensureRole(strapi, 'comite', 'Comite');
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

  // ——— Socle back-office M5 (B1/§4.2) — donner corps aux roles internes ———
  // Aucun endpoint de gestion n'est owner-scope : la garde est le ROLE. La separation
  // des fonctions (8.1.1) est materialisee par les permissions (l'instructeur PROPOSE,
  // seul l'ugp VALIDE / reassigne / pilote les appels). `comite` et `banque` restent
  // sans permissions (phases 2 et 5).
  const gestionBaseActions = [
    'api::gestion.gestion.dossiers',
    'api::gestion.gestion.dossier',
    'api::gestion.gestion.appels',
    'api::portal-compte.portal-compte.moi',
  ];
  // Phase 2 — évaluation : l'instructeur (évaluateur Cabinet) remplit/soumet SES fiches ;
  // l'ugp assigne, consolide, fige. E3 (indépendance) garantie côté serveur (pas de perm croisée).
  const evaluationInstructeurActions = [
    'api::gestion.gestion-evaluation.mesEvaluations',
    'api::gestion.gestion-evaluation.fiche',
    'api::gestion.gestion-evaluation.declarerCoi',
    'api::gestion.gestion-evaluation.recuser',
    'api::gestion.gestion-evaluation.enregistrerFiche',
    'api::gestion.gestion-evaluation.soumettreFiche',
  ];
  const evaluationUgpActions = [
    'api::gestion.gestion-evaluation.evaluationAssign',
    'api::gestion.gestion-evaluation.assigner',
    'api::gestion.gestion-evaluation.consolidationDetail',
    'api::gestion.gestion-evaluation.harmoniser',
    'api::gestion.gestion-evaluation.troisiemeEvaluateur',
    'api::gestion.gestion-evaluation.figer',
  ];
  // Phase 3 (actes de subvention) — Cabinet dépose les avis techniques ; l'UGP valide/décide/signe.
  const subventionInstructeurActions = [
    'api::gestion.gestion-subventions.subventions', 'api::gestion.gestion-subventions.subvention',
    'api::gestion.gestion-subventions.conditionAvisTechnique', 'api::gestion.gestion-subventions.decaissementAvisTechnique',
  ];
  const subventionUgpActions = [
    'api::gestion.gestion-subventions.conditionValider', 'api::gestion.gestion-subventions.conditionActionRequise',
    'api::gestion.gestion-subventions.signer',
    'api::gestion.gestion-subventions.decaissementAvisFiduciaire', 'api::gestion.gestion-subventions.justificationValider', 'api::gestion.gestion-subventions.justificationComplement',
    'api::gestion.gestion-subventions.jalonDateReelle',
    'api::gestion.gestion-subventions.mesureEmettre', 'api::gestion.gestion-subventions.mesureValider',
    'api::gestion.gestion-subventions.suspendre', 'api::gestion.gestion-subventions.lever',
  ];
  // M6 (suivi-evaluation, §14 K1-K5) — instructeur LIT + saisit/propose le depouillement ;
  // UGP valide le depouillement, saisit les valeurs externes, genere les syntheses.
  const seInstructeurActions = [
    'api::gestion.gestion-se.tableauDeBord',
    'api::gestion.gestion-se.indicateurs',
    'api::gestion.gestion-se.depouillements',
    'api::gestion.gestion-se.rapports',
    'api::gestion.gestion-se.depouillementProposer',
  ];
  const seUgpActions = [
    'api::gestion.gestion-se.depouillementValider',
    'api::gestion.gestion-se.depouillementRenvoyer',
    'api::gestion.gestion-se.genererRapport',
  ];
  // Phase 5 (non-objection outillée, §6.7 I1-I4) — instructeur LIT (appui Cabinet), UGP ÉCRIT.
  const nonObjectionInstructeurActions = [
    'api::gestion.gestion-nonobjection.demandes',
    'api::gestion.gestion-nonobjection.demande',
    'api::gestion.gestion-nonobjection.cas',
    'api::gestion.gestion-nonobjection.paquet',
  ];
  const nonObjectionUgpActions = [
    'api::gestion.gestion-nonobjection.creer',
    'api::gestion.gestion-nonobjection.synthese',
    'api::gestion.gestion-nonobjection.piece',
    'api::gestion.gestion-nonobjection.generer',
    'api::gestion.gestion-nonobjection.transmettre',
    'api::gestion.gestion-nonobjection.accord',
    'api::gestion.gestion-nonobjection.observations',
    'api::gestion.gestion-nonobjection.reversion',
  ];
  // Phase 4 (assistance côté équipe, §19 H1-H4) — même jeu pour Cabinet et UGP
  // (H2 : les deux rôles traitent les demandes ; comite exclu). L'UGP hérite via spread.
  const assistanceEquipeActions = [
    'api::gestion.gestion-assistance.demandes',
    'api::gestion.gestion-assistance.demande',
    'api::gestion.gestion-assistance.prendre',
    'api::gestion.gestion-assistance.liberer',
    'api::gestion.gestion-assistance.repondre',
    'api::gestion.gestion-assistance.resoudre',
    'api::gestion.gestion-assistance.operateurs',
    'api::gestion.gestion-assistance.rattachements',
    'api::gestion.gestion-assistance.creerPourOperateur',
    // Pièces jointes des deux côtés du fil (A4) — le Cabinet doit pouvoir téléverser.
    'plugin::upload.content-api.upload',
  ];
  // Phase 2 temps 2 — rapport/Comité/décisions/publication.
  // Cabinet (instructeur) rédige le rapport ; ugp valide/décide/publie ; comite lit la séance.
  const comiteInstructeurActions = [
    'api::gestion.gestion-comite.rapport',
    'api::gestion.gestion-comite.rapportDossier',
    'api::gestion.gestion-comite.rapportSoumettre',
  ];
  const comiteUgpActions = [
    'api::gestion.gestion-comite.seanceCourante',
    'api::gestion.gestion-comite.rapportValider',
    'api::gestion.gestion-comite.rapportRenvoyer',
    'api::gestion.gestion-comite.seance',
    'api::gestion.gestion-comite.decisions',
    'api::gestion.gestion-comite.decisionDossier',
    'api::gestion.gestion-comite.decisionPresents',
    'api::gestion.gestion-comite.genererPv',
    'api::gestion.gestion-comite.joindrePvSigne',
    'api::gestion.gestion-comite.cloreSeance',
    'api::gestion.gestion-comite.publication',
    'api::gestion.gestion-comite.nonObjection',
    'api::gestion.gestion-comite.publier',
  ];

  const instructeurActions = [
    ...gestionBaseActions,
    'api::gestion.gestion.priseEnCharge',
    'api::gestion.gestion.proposerCompletude',
    'api::gestion.gestion.proposerEligibilite',
    ...evaluationInstructeurActions,
    ...comiteInstructeurActions,
    ...subventionInstructeurActions,
    ...assistanceEquipeActions,
    ...nonObjectionInstructeurActions,
    ...seInstructeurActions,
  ];
  const ugpActions = [
    ...instructeurActions,
    'api::gestion.gestion.reassigner',
    'api::gestion.gestion.validerCompletude',
    'api::gestion.gestion.renvoyerCompletude',
    'api::gestion.gestion.validerEligibilite',
    'api::gestion.gestion.renvoyerEligibilite',
    'api::gestion.gestion.ouvrirAppel',
    'api::gestion.gestion.cloreAppel',
    ...evaluationUgpActions,
    ...comiteUgpActions,
    ...subventionUgpActions,
    ...nonObjectionUgpActions,
    ...seUgpActions,
    // Upload : notification signée (rejet) + PV signé + document non-objection + convention/ACD (phase 3).
    'plugin::upload.content-api.upload',
  ];
  // Comité (F2 — lecture cloisonnée) : uniquement le dossier de séance + son identité.
  const comiteActions = ['api::gestion.gestion-comite.seance', 'api::gestion.gestion-comite.seanceCourante', 'api::portal-compte.portal-compte.moi'];
  for (const action of comiteActions) {
    await setPermission(strapi, comiteRole.id, action, true);
  }
  for (const action of instructeurActions) {
    await setPermission(strapi, instructeurRole.id, action, true);
  }
  for (const action of ugpActions) {
    await setPermission(strapi, ugpRole.id, action, true);
  }

  return {
    candidateRole,
    instructeurRole,
    ugpRole,
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

  // Cas de non-objection (referentiel 6.7.1, phase 5) — liste "adaptable" (editable CMS).
  for (const row of [
    { code: 'a', libelle: 'Approbation de la phase pilote', ordre: 10 },
    { code: 'b', libelle: 'Approbation des premiers projets (selection)', ordre: 20 },
    { code: 'c', libelle: 'Modification substantielle du Manuel', ordre: 30 },
    { code: 'd', libelle: "Modification des criteres d'eligibilite / selection", ordre: 40 },
    { code: 'e', libelle: 'Derogation exceptionnelle', ordre: 50 },
    { code: 'f', libelle: 'Convention / engagement soumis a revue prealable', ordre: 60 },
    { code: 'g', libelle: 'Risque fiduciaire eleve', ordre: 70 },
    { code: 'h', libelle: 'Risque environnemental ou social majeur', ordre: 80 },
    { code: 'i', libelle: 'Autre cas demande par la Banque mondiale', ordre: 90 },
  ]) {
    await upsertDocument(strapi, 'api::cas-non-objection.cas-non-objection', { code: row.code }, row);
  }

  // Indicateurs de suivi-evaluation (M6, referentiel §14.3 — cibles = placeholders « a confirmer »).
  for (const row of [
    { code: 'res_infra_financees', famille: 'resultats', libelle: 'Infrastructures productives financees', mode: 'calcule', unite: '', cible: '25', ordre: 10 },
    { code: 'res_projets_acheves', famille: 'resultats', libelle: 'Projets acheves', mode: 'calcule', unite: '', cible: '20', ordre: 20 },
    { code: 'res_taux_execution', famille: 'resultats', libelle: "Taux d'execution financiere", mode: 'calcule', unite: '%', cible: '>= 80 %', ordre: 30 },
    { code: 'res_invest_mobilises', famille: 'resultats', libelle: 'Investissements prives mobilises (contreparties)', mode: 'calcule', unite: '$', cible: 'a confirmer', ordre: 40 },
    { code: 'imp_emplois_crees', famille: 'impact', libelle: 'Emplois crees', mode: 'saisi', unite: '', cible: '400', ordre: 50 },
    { code: 'imp_operateurs_benef', famille: 'impact', libelle: 'Operateurs (MPME/coop.) beneficiaires', mode: 'calcule', unite: '', cible: '25', ordre: 60 },
    { code: 'imp_beneficiaires', famille: 'impact', libelle: 'Beneficiaires touches', mode: 'saisi', unite: '', cible: 'a confirmer', ordre: 70 },
    { code: 'inc_part_femmes', famille: 'inclusion', libelle: 'Part de femmes beneficiaires', mode: 'calcule', unite: '%', cible: '>= 50 %', ordre: 80 },
    { code: 'inc_projets_femmes', famille: 'inclusion', libelle: 'Projets portes par des femmes', mode: 'calcule', unite: '%', cible: 'a confirmer', ordre: 90 },
    { code: 'inc_part_jeunes', famille: 'inclusion', libelle: 'Part de jeunes', mode: 'calcule', unite: '%', cible: 'a confirmer', ordre: 100 },
    { code: 'inc_part_refugies', famille: 'inclusion', libelle: 'Part de refugies', mode: 'calcule', unite: '%', cible: 'a confirmer', ordre: 110 },
    { code: 'fid_delai_paiement', famille: 'fiduciaires', libelle: 'Delai moyen de traitement des paiements', mode: 'calcule', unite: 'j', cible: '5-10 j', ordre: 120 },
    { code: 'fid_taux_rejet', famille: 'fiduciaires', libelle: 'Taux de rejet des depenses', mode: 'calcule', unite: '%', cible: 'a confirmer', ordre: 130 },
    { code: 'fid_irregularites', famille: 'fiduciaires', libelle: 'Irregularites constatees', mode: 'saisi', unite: '', cible: '0', ordre: 140 },
    { code: 'es_conformite', famille: 'es', libelle: 'Projets conformes aux exigences E&S', mode: 'calcule', unite: '%', cible: '100 %', ordre: 150 },
    { code: 'es_plaintes', famille: 'es', libelle: 'Plaintes enregistrees (source MGP externe)', mode: 'saisi', unite: '', cible: '-', ordre: 160 },
    { code: 'es_incidents', famille: 'es', libelle: 'Incidents E&S signales', mode: 'saisi', unite: '', cible: '0', ordre: 170 },
  ]) {
    await upsertDocument(strapi, 'api::indicateur.indicateur', { code: row.code }, row);
  }

  // K5 — canaux du Mecanisme de Gestion des Plaintes (MGP §13), affiches cote operateur
  // via la FAQ (contenu CMS, zero code operateur). Placeholder a confirmer UGP.
  await upsertDocument(strapi, 'api::faq-entree.faq-entree', { question: 'Comment deposer une plainte (mecanisme de gestion des plaintes) ?' }, {
    question: 'Comment deposer une plainte (mecanisme de gestion des plaintes) ?',
    ordre: 200,
    reponse: [{ type: 'paragraph', children: [{ type: 'text', text: "Le Projet PRETE dispose d'un mecanisme de gestion des plaintes (MGP) distinct de l'assistance. Vous pouvez deposer une plainte, y compris de maniere confidentielle, via les canaux officiels du projet (a confirmer UGP : ligne telephonique dediee, adresse e-mail, points focaux). Les plaintes sensibles (EAS/HS) sont traitees de facon confidentielle par un dispositif specialise." }] }],
  });

  // Migration phase 5 : l'ancien statut `a_demander` (2b) devient `en_preparation`.
  const legacyNobj = await strapi.documents('api::non-objection.non-objection').findMany({ filters: { statut: 'a_demander' }, limit: 100 });
  for (const nobj of legacyNobj) {
    await strapi.documents('api::non-objection.non-objection').update({ documentId: nobj.documentId, data: { statut: 'en_preparation' } });
  }

  // ——— Referentiels du socle back-office M5 ———
  // Criteres d'eligibilite (grille Annexe 5 / §5) : libelles = PLACEHOLDERS, definitifs = contenu CMS.
  const criteres = [
    { code: 'statut-juridique', libelle: 'Statut juridique eligible (MPME, cooperative, association, ONG)', refManuel: '§5.1', ordre: 10 },
    { code: 'existence-legale', libelle: 'Existence legale et documents juridiques valides', refManuel: '§5.2', ordre: 20 },
    { code: 'contrepartie-20', libelle: 'Contrepartie >= 20 % confirmee et sourcee', refManuel: '§5.4', ordre: 30 },
    { code: 'chaine-valeur', libelle: 'Chaine de valeur prioritaire ou projet transversal', refManuel: '§2.3', ordre: 40 },
    { code: 'infrastructure', libelle: 'Infrastructure productive eligible', refManuel: '§2.5', ordre: 50 },
    { code: 'site-implantation', libelle: "Site d'implantation conforme", refManuel: '§5.6', ordre: 60 },
    { code: 'conflit-interet', libelle: "Absence de conflit d'interets", refManuel: '§5.8.1', ordre: 70 },
    { code: 'conformite-es', libelle: 'Conformite environnementale et sociale prealable', refManuel: '§5.7', ordre: 80 },
    { code: 'depenses-eligibles', libelle: 'Depenses prevues eligibles', refManuel: '§2.6 / §5.4', ordre: 90 },
  ];
  for (const row of criteres) {
    await upsertDocument(strapi, 'api::critere-eligibilite.critere-eligibilite', { code: row.code }, row);
  }

  // Parametre d'instruction (single type) : delai par defaut des complements (Annexe 11 —
  // valeur PLACEHOLDER a confirmer UGP ; c'est la FORME qui est provisionnee, pas la valeur).
  const paramExisting = await strapi.documents('api::parametres-instruction.parametres-instruction').findFirst({});
  if (paramExisting?.documentId) {
    if (paramExisting.delaiComplementsJours == null) {
      await strapi.documents('api::parametres-instruction.parametres-instruction').update({ documentId: paramExisting.documentId, data: { delaiComplementsJours: 10 } });
    }
  } else {
    await strapi.documents('api::parametres-instruction.parametres-instruction').create({ data: { delaiComplementsJours: 10 } });
  }

  // ——— Phase 2 : barème d'évaluation (grille §6, éditable — E1 : rien en dur) ———
  // E1 arbitré : A6 (E&S) = porte ELIMINATOIRE non notée ; A5 Impact socio-éco = 15.
  const criteresEval = [
    { code: 'A1', bloc: 'A', libelle: 'Pertinence stratégique', description: 'Alignement PRETE, PAD, priorités nationales, emplois, inclusion', points: 15, type: 'note', ordre: 10 },
    { code: 'A2', bloc: 'A', libelle: 'Cohérence technique', description: 'Intégration production–transformation–logistique–commercialisation', points: 10, type: 'note', ordre: 20 },
    { code: 'A3', bloc: 'A', libelle: 'Faisabilité technique', description: 'Maturité, site, technologie, calendrier, conformité réglementaire', points: 10, type: 'note', ordre: 30 },
    { code: 'A4', bloc: 'A', libelle: 'Viabilité économique', description: "Rentabilité, débouchés, solidité du plan d'affaires", points: 10, type: 'note', ordre: 40 },
    { code: 'A5', bloc: 'A', libelle: 'Impact socio-économique', description: "Emplois, inclusion, effets d'entraînement local", points: 15, type: 'note', ordre: 50 },
    { code: 'A6', bloc: 'A', libelle: 'Conformité environnementale et sociale', description: 'Porte préalable éliminatoire (§6.2.1) — non notée', points: 0, type: 'eliminatoire', ordre: 60 },
    { code: 'B1', bloc: 'B', libelle: 'Conformité juridique et réglementaire', description: 'Statut légal, conformité fiscale et sociale, absence de contentieux', points: 5, type: 'note', ordre: 70 },
    { code: 'B2', bloc: 'B', libelle: 'Capacité financière', description: 'Solidité, accès aux ressources, mobilisation de la contrepartie', points: 10, type: 'note', ordre: 80 },
    { code: 'B3', bloc: 'B', libelle: 'Capacité technique et managériale', description: 'Expérience, organisation, ressources humaines clés', points: 10, type: 'note', ordre: 90 },
    { code: 'B4', bloc: 'B', libelle: "Capacité d'exploitation et maintenance (O&M)", description: "Plan d'exploitation, maintenance, modèle opérationnel", points: 10, type: 'note', ordre: 100 },
    { code: 'B5', bloc: 'B', libelle: 'Gouvernance et transparence', description: 'Organisation, procédures internes, gestion des risques', points: 5, type: 'note', ordre: 110 },
    { code: 'G', bloc: 'bonus', libelle: 'Genre', description: '≥ 50 % de bénéficiaires femmes ou women-led', points: 5, type: 'note', ordre: 120 },
    { code: 'J', bloc: 'bonus', libelle: 'Jeunes / réfugiés', description: 'Intégration substantielle de jeunes ou réfugiés', points: 3, type: 'note', ordre: 130 },
    { code: 'L', bloc: 'bonus', libelle: 'Local / rural', description: 'Impact significatif en zones rurales / fragiles', points: 2, type: 'note', ordre: 140 },
  ];
  for (const row of criteresEval) {
    await upsertDocument(strapi, 'api::critere-evaluation.critere-evaluation', { code: row.code }, row);
  }

  const bandes = [
    { min: 80, label: 'Recommandé pour financement' },
    { min: 70, label: 'Recommandé sous conditions' },
    { min: 60, label: "Liste d'attente / révision" },
    { min: 0, label: 'Non retenu (< 60)' },
  ];
  const paramEval = await strapi.documents('api::parametres-evaluation.parametres-evaluation').findFirst({});
  if (paramEval?.documentId) {
    await strapi.documents('api::parametres-evaluation.parametres-evaluation').update({ documentId: paramEval.documentId, data: { seuilBase: paramEval.seuilBase ?? 60, ecartPct: paramEval.ecartPct ?? 0.2, bandes: Array.isArray(paramEval.bandes) && paramEval.bandes.length ? paramEval.bandes : bandes } });
  } else {
    await strapi.documents('api::parametres-evaluation.parametres-evaluation').create({ data: { seuilBase: 60, ecartPct: 0.2, bandes } });
  }

  // Paramètres du Comité (temps 2 — F3 : quorum éditable, placeholder 5 à confirmer UGP §8.10).
  const paramComite = await strapi.documents('api::parametres-comite.parametres-comite').findFirst({});
  if (!paramComite?.documentId) {
    await strapi.documents('api::parametres-comite.parametres-comite').create({ data: { nbMembres: 7, quorumSeuil: 5 } });
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

// ============================================================================
// Donnees de DEMO du socle back-office M5 : 2 comptes internes (instructeur + ugp)
// et une file de dossiers couvrant les etats (recu / completude pris & non pris /
// eligibilite / clos rejete). Idempotent. Portefeuille detenu par un operateur
// « vitrine » distinct du compte de demo operateur (pour ne pas polluer son espace).
// ============================================================================

const GESTION_PASSWORD = DEMO_PASSWORD;
const INSTRUCTEUR_EMAIL = 'demo-instructeur@subco-prete.bi';
const UGP_EMAIL = 'demo-ugp@subco-prete.bi';
const PORTEFEUILLE_EMAIL = 'demo-portefeuille@subco-prete.bi';

async function ensureInternalUser(strapi, { email, orgName, roleType }) {
  const service = strapi.plugin('users-permissions').service('user');
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: roleType } });
  let user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email }, populate: ['role'] });
  if (!user) {
    user = await service.add({
      username: email, email, password: GESTION_PASSWORD, confirmed: true, blocked: false, provider: 'local',
      role: role.id, orgName,
    });
  } else if (user.role?.type !== roleType || user.orgName !== orgName || !user.confirmed) {
    user = await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id }, data: { role: role.id, orgName, confirmed: true, blocked: false }, populate: ['role'],
    });
  }
  return user;
}

async function ensureActeJournal(strapi, candidatureDoc, rows) {
  // N'ecrit le journal qu'une seule fois par dossier (append-only ; pas de doublon a la re-seed).
  const already = await strapi.documents('api::acte-dossier.acte-dossier').findMany({
    filters: { candidature: { documentId: candidatureDoc.documentId } }, limit: 1,
  });
  if (already.length) return;
  for (const r of rows) {
    await strapi.documents('api::acte-dossier.acte-dossier').create({
      data: { candidature: connectRelation(candidatureDoc), date: r.date, auteurLibelle: r.auteur, type: r.type || 'acte', texte: r.texte },
    });
  }
}

async function ensureGestionDemoData(strapi) {
  const instructeur = await ensureInternalUser(strapi, { email: INSTRUCTEUR_EMAIL, orgName: 'A. Ndayizeye', roleType: 'instructeur' });
  const ugp = await ensureInternalUser(strapi, { email: UGP_EMAIL, orgName: 'C. Iradukunda', roleType: 'ugp' });
  const holder = await ensureInternalUser(strapi, { email: PORTEFEUILLE_EMAIL, orgName: 'Portefeuille de demonstration', roleType: 'candidat' });

  const [appel, sSoumis, sCompletude, sEligibilite, sNonRetenu, coop] = await Promise.all([
    findOneBy(strapi, 'api::appel.appel', { codeCohorte: 'C1' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'soumis' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'completude' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'eligibilite' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'non_retenu' }),
    findOneBy(strapi, 'api::statut-juridique.statut-juridique', { libelle: 'Cooperative' }),
  ]);

  const filiereBySlug = {};
  for (const slug of ['fruits-tropicaux', 'volaille', 'lait', 'pisciculture']) {
    filiereBySlug[slug] = await findOneBy(strapi, 'api::filiere.filiere', { slug });
  }

  const pieces = await strapi.documents('api::type-piece.type-piece').findMany({ sort: ['ordre:asc'], limit: 100 });
  const pieceByLibelle = Object.fromEntries(pieces.map((p) => [p.libelle, p]));

  async function ensureOrg(nom, filiereSlug) {
    return upsertDocument(strapi, 'api::organisation.organisation', { nom }, {
      owner: holder.id, nom,
      statutJuridique: connectRelation(coop),
      filierePrincipale: connectRelation(filiereBySlug[filiereSlug]),
    });
  }
  async function ensureDossier(titre, org, statut, numero, dateDepot, prisEnCharge) {
    return upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: titre }, {
      owner: holder.id, appel: connectRelation(appel), organisation: connectRelation(org),
      titreProjet: titre, statut: connectRelation(statut), numeroDossier: numero, dateDepot,
      // null (et non {disconnect:[]}, qui est un no-op) pour restaurer l'etat canonique « non pris ».
      prisEnChargePar: prisEnCharge ? { connect: [prisEnCharge.id] } : null,
      donneesProjet: DEMO_DONNEES,
    });
  }

  // 1) Recu, non pris — Coop. Tuyage (Lait).
  const orgTuyage = await ensureOrg('Coop. Tuyage', 'lait');
  const dTuyage = await ensureDossier('Mini-laiterie de collecte (Tuyage)', orgTuyage, sSoumis, 'PRETE-AP-C1-2026-00044', '2026-07-15T09:05:00.000Z', null);
  await ensureActeJournal(strapi, dTuyage, [{ date: '2026-07-15T09:05:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis — accuse e-mail + SMS envoye' }]);

  // 2) Completude, pris en charge, verdicts de pieces pre-saisis (1 absente + 1 non conforme).
  const orgGirumwete = await ensureOrg('Cooperative Girumwete (demo gestion)', 'fruits-tropicaux');
  const dGirumwete = await ensureDossier('Sechage solaire de mangues (Girumwete)', orgGirumwete, sCompletude, 'PRETE-AP-C1-2026-00072', '2026-07-12T14:02:00.000Z', instructeur);
  if (!(await findOneBy(strapi, 'api::instruction-completude.instruction-completude', { candidature: { documentId: dGirumwete.documentId } }))) {
    const pAbsente = pieceByLibelle['Attestation de non-redevance fiscale'];
    const pNonConf = pieceByLibelle['Justificatif de mobilisation de la contrepartie'];
    const verdictsPieces = {};
    for (const p of pieces) verdictsPieces[p.documentId] = { etat: 'presente' };
    if (pAbsente) verdictsPieces[pAbsente.documentId] = { etat: 'absente', note: 'Piece non fournie au depot' };
    if (pNonConf) verdictsPieces[pNonConf.documentId] = { etat: 'non_conforme', note: 'Document illisible (scan tronque)' };
    await strapi.documents('api::instruction-completude.instruction-completude').create({
      data: { candidature: connectRelation(dGirumwete), verdictsPieces, workflow: 'en_cours' },
    });
  }
  await ensureActeJournal(strapi, dGirumwete, [
    { date: '2026-07-12T14:02:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis — accuse e-mail + SMS envoye' },
    { date: '2026-07-13T09:15:00.000Z', auteur: 'A. Ndayizeye (Cabinet)', type: 'prise_en_charge', texte: 'Prise en charge du dossier (completude)' },
  ]);

  // 3) Completude, non pris — MPME Akeza (Volaille).
  const orgAkeza = await ensureOrg('MPME Akeza', 'volaille');
  const dAkeza = await ensureDossier('Poulailler modernise (Akeza)', orgAkeza, sCompletude, 'PRETE-AP-C1-2026-00043', '2026-07-13T17:40:00.000Z', null);
  await ensureActeJournal(strapi, dAkeza, [{ date: '2026-07-13T17:40:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis — accuse envoye' }]);

  // 4) Eligibilite, pris — Association Dukore (Pisciculture) : completude deja validee (journal coherent).
  const orgDukore = await ensureOrg('Association Dukore', 'pisciculture');
  const dDukore = await ensureDossier('Etangs piscicoles communautaires (Dukore)', orgDukore, sEligibilite, 'PRETE-AP-C1-2026-00046', '2026-07-10T10:00:00.000Z', instructeur);
  if (!(await findOneBy(strapi, 'api::instruction-completude.instruction-completude', { candidature: { documentId: dDukore.documentId } }))) {
    const verdictsPieces = {};
    for (const p of pieces) verdictsPieces[p.documentId] = { etat: 'presente' };
    await strapi.documents('api::instruction-completude.instruction-completude').create({
      data: { candidature: connectRelation(dDukore), verdictsPieces, verdictGlobal: 'complet', workflow: 'valide', proposePar: { connect: [instructeur.id] }, proposeLe: '2026-07-16T09:00:00.000Z', validePar: { connect: [ugp.id] }, valideLe: '2026-07-16T15:20:00.000Z' },
    });
  }
  if (!(await findOneBy(strapi, 'api::instruction-eligibilite.instruction-eligibilite', { candidature: { documentId: dDukore.documentId } }))) {
    await strapi.documents('api::instruction-eligibilite.instruction-eligibilite').create({ data: { candidature: connectRelation(dDukore), workflow: 'en_cours' } });
  }
  await ensureActeJournal(strapi, dDukore, [
    { date: '2026-07-10T10:00:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis' },
    { date: '2026-07-16T09:00:00.000Z', auteur: 'A. Ndayizeye (Cabinet)', type: 'proposition_completude', texte: 'Completude proposee : complet' },
    { date: '2026-07-16T15:20:00.000Z', auteur: 'C. Iradukunda (UGP)', type: 'validation_completude', texte: 'Completude validee — passage a l’eligibilite (notification envoyee)' },
  ]);

  // 5) Clos, rejete a la completude — Ferme avicole de Gihanga (Volaille) + notification signee.
  const orgGihanga = await ensureOrg('Ferme avicole de Gihanga', 'volaille');
  const dGihanga = await ensureDossier('Extension avicole (Gihanga)', orgGihanga, sNonRetenu, 'PRETE-AP-C1-2026-00047', '2026-07-02T09:00:00.000Z', instructeur);
  const gihangaCurrent = await strapi.documents('api::candidature.candidature').findOne({ documentId: dGihanga.documentId, populate: ['notificationDecision'] });
  if (!gihangaCurrent?.notificationDecision) {
    const signedId = await uploadDemoPieceImage(strapi, 'Notification de decision (signee)');
    await strapi.documents('api::candidature.candidature').update({
      documentId: dGihanga.documentId,
      data: { motifDecisionCourt: 'Dossier incomplet : pieces obligatoires manquantes non regularisees.', notificationDecision: signedId || null },
    });
  }
  if (!(await findOneBy(strapi, 'api::instruction-completude.instruction-completude', { candidature: { documentId: dGihanga.documentId } }))) {
    await strapi.documents('api::instruction-completude.instruction-completude').create({
      data: { candidature: connectRelation(dGihanga), verdictGlobal: 'rejet', motifRejet: 'Dossier incomplet : pieces obligatoires manquantes non regularisees.', workflow: 'valide', proposePar: { connect: [instructeur.id] }, proposeLe: '2026-07-08T10:00:00.000Z', validePar: { connect: [ugp.id] }, valideLe: '2026-07-09T11:00:00.000Z' },
    });
  }
  await ensureActeJournal(strapi, dGihanga, [
    { date: '2026-07-02T09:00:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis' },
    { date: '2026-07-09T11:00:00.000Z', auteur: 'C. Iradukunda (UGP)', type: 'validation_completude', texte: 'Rejet valide — notification signee jointe' },
  ]);
}

// ============================================================================
// Donnees de DEMO de la phase 2 (evaluation & consolidation) : 2 evaluateurs
// (instructeur) + 1 dossier avec 2 fiches soumises presentant 2 ecarts >= 20 %
// (A3, A5) -> consolidation en_cours (test harmonisation / 3e eval / figeage) +
// 1 dossier assigne SANS fiche (parcours evaluateur complet : COI, E&S, notation).
// ============================================================================

// Notes de demo (issues de la maquette) : E1 et E2 divergent sur A3 et A5 (ecarts >= 20 %).
// E1/E2 calibrees pour presenter EXACTEMENT 2 ecarts >= 20 % (A3, A5) — cf. maquette.
const EVAL_E1 = { A1: 13, A2: 8, A3: 9, A4: 8, A5: 12, B1: 4, B2: 8, B3: 8, B4: 7, B5: 4 };
const EVAL_E2 = { A1: 12, A2: 7, A3: 6, A4: 8, A5: 9, B1: 4, B2: 7, B3: 8, B4: 7, B5: 4 };
const EVAL_BONUS = { G: 5, J: 3, L: 2 };

function notesFrom(map, evalNum) {
  const notes = {};
  for (const [code, note] of Object.entries(map)) {
    notes[code] = { note, commentaire: `Appreciation evaluateur ${evalNum} sur ${code} (demo).` };
  }
  return notes;
}

async function ensureEvaluationDemoData(strapi) {
  const eval1 = await ensureInternalUser(strapi, { email: 'demo-eval1@subco-prete.bi', orgName: 'D. Habonimana', roleType: 'instructeur' });
  const eval2 = await ensureInternalUser(strapi, { email: 'demo-eval2@subco-prete.bi', orgName: 'E. Nizigiyimana', roleType: 'instructeur' });
  const ugp = await ensureInternalUser(strapi, { email: UGP_EMAIL, orgName: 'C. Iradukunda', roleType: 'ugp' });
  const holder = await ensureInternalUser(strapi, { email: PORTEFEUILLE_EMAIL, orgName: 'Portefeuille de demonstration', roleType: 'candidat' });

  const [appel, sEvaluation, coop, filPisci, filVolaille] = await Promise.all([
    findOneBy(strapi, 'api::appel.appel', { codeCohorte: 'C1' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'evaluation' }),
    findOneBy(strapi, 'api::statut-juridique.statut-juridique', { libelle: 'Cooperative' }),
    findOneBy(strapi, 'api::filiere.filiere', { slug: 'pisciculture' }),
    findOneBy(strapi, 'api::filiere.filiere', { slug: 'volaille' }),
  ]);

  async function ensureOrg(nom, filiere) {
    return upsertDocument(strapi, 'api::organisation.organisation', { nom }, {
      owner: holder.id, nom, statutJuridique: connectRelation(coop), filierePrincipale: connectRelation(filiere),
    });
  }
  async function ensureDossier(titre, org, numero, dateDepot) {
    return upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: titre }, {
      owner: holder.id, appel: connectRelation(appel), organisation: connectRelation(org),
      titreProjet: titre, statut: connectRelation(sEvaluation), numeroDossier: numero, dateDepot, donneesProjet: DEMO_DONNEES,
    });
  }
  async function ensureAssignation(candidature, evaluateur, rang) {
    const items = await strapi.documents('api::assignation-evaluation.assignation-evaluation').findMany({
      filters: { candidature: { documentId: candidature.documentId }, rang }, limit: 1,
    });
    if (items[0]) return items[0];
    return strapi.documents('api::assignation-evaluation.assignation-evaluation').create({
      data: { candidature: connectRelation(candidature), evaluateur: { connect: [evaluateur.id] }, rang, assignePar: { connect: [ugp.id] }, assigneLe: '2026-07-17T09:00:00.000Z', statut: 'assignee' },
    });
  }
  async function ensureFiche(candidature, evaluateur, rang, notes) {
    const data = { rang, coiDeclare: true, esConforme: true, notes, bonus: EVAL_BONUS, statut: 'soumise', signeLe: '2026-07-18T10:00:00.000Z', signePar: { connect: [evaluateur.id] } };
    const items = await strapi.documents('api::fiche-scoring.fiche-scoring').findMany({
      filters: { candidature: { documentId: candidature.documentId }, evaluateur: { id: evaluateur.id } }, limit: 1,
    });
    // Fiche de demo autoritative : on remet les notes canoniques a chaque seed (idempotent).
    if (items[0]) return strapi.documents('api::fiche-scoring.fiche-scoring').update({ documentId: items[0].documentId, data });
    return strapi.documents('api::fiche-scoring.fiche-scoring').create({
      data: { candidature: connectRelation(candidature), evaluateur: { connect: [evaluateur.id] }, ...data },
    });
  }

  // 1) Dossier avec 2 fiches soumises + ecarts A3/A5 -> consolidation en_cours.
  const orgRugombo = await ensureOrg('Coop. Rugombo', filPisci);
  const dRugombo = await ensureDossier('Etangs piscicoles integres (Rugombo)', orgRugombo, 'PRETE-AP-C1-2026-00081', '2026-07-06T09:00:00.000Z');
  await ensureAssignation(dRugombo, eval1, 1);
  await ensureAssignation(dRugombo, eval2, 2);
  await ensureFiche(dRugombo, eval1, 1, notesFrom(EVAL_E1, 1));
  await ensureFiche(dRugombo, eval2, 2, notesFrom(EVAL_E2, 2));
  // Consolidation de demo autoritative : remise a en_cours vierge a chaque seed
  // (les ecarts A3/A5 restent a traiter — etat de depart canonique de la demo).
  const consExisting = await findOneBy(strapi, 'api::consolidation.consolidation', { candidature: { documentId: dRugombo.documentId } });
  const consData = { notesRetenues: {}, ecarts: [], statut: 'en_cours', totalA: null, totalB: null, bonus: null, totalHorsBonus: null, totalFinal: null, bande: null, figeeLe: null };
  if (consExisting?.documentId) {
    await strapi.documents('api::consolidation.consolidation').update({ documentId: consExisting.documentId, data: consData });
  } else {
    await strapi.documents('api::consolidation.consolidation').create({ data: { candidature: connectRelation(dRugombo), ...consData } });
  }
  await ensureActeJournal(strapi, dRugombo, [
    { date: '2026-07-06T09:00:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis' },
    { date: '2026-07-17T09:00:00.000Z', auteur: 'C. Iradukunda (UGP)', type: 'assignation', texte: 'Assignation evaluateurs 1 (D. Habonimana) et 2 (E. Nizigiyimana) (E2)' },
    { date: '2026-07-18T10:00:00.000Z', auteur: 'D. Habonimana (Cabinet)', type: 'fiche_soumise', texte: 'Fiche de scoring soumise & signee (evaluateur 1)' },
    { date: '2026-07-18T14:00:00.000Z', auteur: 'E. Nizigiyimana (Cabinet)', type: 'fiche_soumise', texte: 'Fiche de scoring soumise & signee (evaluateur 2)' },
    { date: '2026-07-18T14:00:00.000Z', auteur: 'Systeme', type: 'consolidation_ouverte', texte: 'Les deux fiches sont soumises — consolidation ouverte (E3 levee)' },
  ]);

  // 2) Dossier assigne SANS fiche (parcours evaluateur complet a tester).
  const orgKarera = await ensureOrg('MPME Karera', filVolaille);
  const dKarera = await ensureDossier('Couvoir avicole modernise (Karera)', orgKarera, 'PRETE-AP-C1-2026-00082', '2026-07-08T09:00:00.000Z');
  await ensureAssignation(dKarera, eval1, 1);
  await ensureAssignation(dKarera, eval2, 2);
  // Etat de depart canonique : AUCUNE fiche (parcours evaluateur complet a tester).
  for (const uid of ['api::fiche-scoring.fiche-scoring', 'api::consolidation.consolidation']) {
    const stale = await strapi.documents(uid).findMany({ filters: { candidature: { documentId: dKarera.documentId } }, limit: 10 });
    for (const s of stale) await strapi.documents(uid).delete({ documentId: s.documentId });
  }
  await ensureActeJournal(strapi, dKarera, [
    { date: '2026-07-08T09:00:00.000Z', auteur: 'Systeme', type: 'depot', texte: 'Dossier soumis' },
    { date: '2026-07-17T09:30:00.000Z', auteur: 'C. Iradukunda (UGP)', type: 'assignation', texte: 'Assignation evaluateurs 1 et 2 (E2)' },
  ]);
}

// ============================================================================
// Donnees de DEMO du temps 2 (rapport, Comite, decisions, publication) :
// 1 compte `comite` + 4 dossiers en phase `evaluation` avec consolidations FIGEES
// (bases 88 / 79 / 66 / 58 -> recos selection / conditionnelle / attente / rejet),
// rapport en brouillon, seance ouverte, non-objection requise (cohorte pilote).
// Autoritatif : remet l'etat de depart a chaque seed (re-demoable apres publication).
// ============================================================================

const COMITE_DOSSIERS = [
  { org: 'Cooperative Vunga', num: 'PRETE-AP-C1-2026-00051', titre: 'Chambre froide — Rumonge', fil: 'fruits-tropicaux', a: 54, b: 34, bonus: 8, a5: 14, harmon: false,
    forces: ['Pertinence strategique forte', "Plan d'affaires solide"], faiblesses: ['Maintenance a preciser'], conditions: [] },
  { org: 'Cooperative Nyaruguru', num: 'PRETE-AP-C1-2026-00052', titre: 'Etang piscicole — Nyanza-Lac', fil: 'pisciculture', a: 48, b: 31, bonus: 9, a5: 12, harmon: true,
    forces: ['Impact inclusion eleve (women-led)'], faiblesses: ["Site d'implantation a securiser", 'Capacite O&M limitee'],
    conditions: [{ texte: "Securiser le titre d'occupation du site", type: 'site' }, { texte: 'Renforcer le plan de maintenance avant signature', type: 'plan_affaires' }] },
  { org: 'MPME Bwiza', num: 'PRETE-AP-C1-2026-00053', titre: 'Poulailler moderne — Gihanga', fil: 'volaille', a: 40, b: 26, bonus: 6, a5: 9, harmon: false,
    forces: ['Debouches confirmes'], faiblesses: ['Coherence technique moyenne', 'Gouvernance a structurer'], conditions: [] },
  { org: 'Cooperative Rima', num: 'PRETE-AP-C1-2026-00054', titre: 'Unite laitiere — Gitega', fil: 'lait', a: 38, b: 20, bonus: 4, a5: 7, harmon: false,
    forces: [], faiblesses: ['Faisabilite insuffisante', 'Viabilite economique fragile'], conditions: [] },
];

function recoDemo(base) { return base >= 80 ? 'selection' : base >= 70 ? 'conditionnelle' : base >= 60 ? 'attente' : 'rejet'; }
function bandeDemo(base) { return base >= 80 ? 'Recommandé pour financement' : base >= 70 ? 'Recommandé sous conditions' : base >= 60 ? "Liste d'attente / révision" : 'Non retenu (< 60)'; }

async function ensureComiteDemoData(strapi) {
  await ensureInternalUser(strapi, { email: 'demo-comite@subco-prete.bi', orgName: 'Comite de selection', roleType: 'comite' });
  const holder = await ensureInternalUser(strapi, { email: PORTEFEUILLE_EMAIL, orgName: 'Portefeuille de demonstration', roleType: 'candidat' });

  const [appel, sEvaluation, coop] = await Promise.all([
    findOneBy(strapi, 'api::appel.appel', { codeCohorte: 'C1' }),
    findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'evaluation' }),
    findOneBy(strapi, 'api::statut-juridique.statut-juridique', { libelle: 'Cooperative' }),
  ]);

  for (const row of COMITE_DOSSIERS) {
    const filiere = await findOneBy(strapi, 'api::filiere.filiere', { slug: row.fil });
    const org = await upsertDocument(strapi, 'api::organisation.organisation', { nom: row.org }, {
      owner: holder.id, nom: row.org, statutJuridique: connectRelation(coop), filierePrincipale: connectRelation(filiere),
    });
    const cand = await upsertDocument(strapi, 'api::candidature.candidature', { titreProjet: row.titre }, {
      owner: holder.id, appel: connectRelation(appel), organisation: connectRelation(org), titreProjet: row.titre,
      statut: connectRelation(sEvaluation), numeroDossier: row.num, dateDepot: '2026-07-05T09:00:00.000Z',
      donneesProjet: { ...DEMO_DONNEES, financement: { budgetTotal: 120000000, contrepartie: 24000000, typeContrepartie: 'Numeraire' } },
      motifDecisionCourt: null,
    });

    const base = row.a + row.b;
    const notesRetenues = { A5: { retenue: row.a5 }, ...(row.harmon ? { A3: { retenue: 8, harmonisee: true } } : {}) };
    const consData = { notesRetenues, ecarts: [], statut: 'figee', totalA: row.a, totalB: row.b, bonus: row.bonus, totalHorsBonus: base, totalFinal: Math.min(100, base) + row.bonus, bande: bandeDemo(base), figeeLe: '2026-07-20T10:00:00.000Z' };
    const consExisting = await findOneBy(strapi, 'api::consolidation.consolidation', { candidature: { documentId: cand.documentId } });
    if (consExisting?.documentId) await strapi.documents('api::consolidation.consolidation').update({ documentId: consExisting.documentId, data: consData });
    else await strapi.documents('api::consolidation.consolidation').create({ data: { candidature: connectRelation(cand), ...consData } });

    // evaluation-dossier autoritatif (reco depuis la bande, decisions remises a null).
    const edData = { rang: null, reco: recoDemo(base), forces: row.forces, faiblesses: row.faiblesses, conditions: row.conditions, decisionComite: null, motifAjustement: null, motifReco: null };
    const edExisting = await findOneBy(strapi, 'api::evaluation-dossier.evaluation-dossier', { candidature: { documentId: cand.documentId } });
    if (edExisting?.documentId) await strapi.documents('api::evaluation-dossier.evaluation-dossier').update({ documentId: edExisting.documentId, data: edData });
    else await strapi.documents('api::evaluation-dossier.evaluation-dossier').create({ data: { candidature: connectRelation(cand), ...edData } });

    // Nettoyage des effets d'une publication anterieure (subvention + conditions) -> re-demoable.
    const subs = await strapi.documents('api::subvention.subvention').findMany({ filters: { candidature: { documentId: cand.documentId } }, populate: ['conditionsPrealables'], limit: 5 });
    for (const s of subs) {
      for (const c of s.conditionsPrealables || []) await strapi.documents('api::condition-prealable.condition-prealable').delete({ documentId: c.documentId });
      await strapi.documents('api::subvention.subvention').delete({ documentId: s.documentId });
    }
  }

  // Rapport brouillon (reset), seance ouverte (reset), non-objection requise, publication effacee.
  await resetSingletonByAppel(strapi, 'api::rapport-evaluation.rapport-evaluation', appel, { statut: 'brouillon', pdf: null, soumisLe: null, valideLe: null, commentaireRenvoi: null });
  await resetSingletonByAppel(strapi, 'api::seance-comite.seance-comite', appel, { presents: 0, statut: 'ouverte', pvGenere: null, pvSigne: null, reserves: null, closeLe: null });

  // Phase 5 : la non-objection de la C1 devient la « demande de selection » outillee
  // (cas b), en preparation, synthese chiffree calculee depuis les donnees de demo.
  const casB = await findOneBy(strapi, 'api::cas-non-objection.cas-non-objection', { code: 'b' });
  const synthese = await computeSyntheseSeed(strapi, appel.documentId);
  await resetSingletonByAppel(strapi, 'api::non-objection.non-objection', appel, {
    requise: true, statut: 'en_preparation', dateTransmission: null, dateAccord: null, document: null,
    type: casB ? connectRelation(casB) : null, objet: 'Selection des projets — Cohorte 1', reference: 'Cohorte 1',
    version: 1, syntheseChiffree: synthese, observations: null, ajustements: null, dateObservations: null,
    pieceEs: null, pieceFiduciaire: null, demandePdf: null,
  });
  const pubs = await strapi.documents('api::publication-decisions.publication-decisions').findMany({ filters: { appel: { documentId: appel.documentId } }, limit: 5 });
  for (const p of pubs) await strapi.documents('api::publication-decisions.publication-decisions').delete({ documentId: p.documentId });
}

// Synthese chiffree (phase 5, I2) calculee depuis les donnees d'instruction/consolidation.
async function computeSyntheseSeed(strapi, appelDocumentId) {
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

// M5 phase 5 — 1 demande « autre cas » (derogation e) transmise, demande redigee jointe.
// M6 — Suivi-evaluation (K1/K5) : depouillements de demo + 1 valeur saisie externe (plaintes).
async function ensureSeDemo(strapi) {
  // Backfill : chaque rapport `transmis` sans depouillement en recoit un (a_depouiller).
  const transmis = await strapi.documents('api::rapport-requis.rapport-requis').findMany({ filters: { statut: 'transmis' }, fields: ['documentId', 'periodeLibelle'], populate: { type: { fields: ['code'] } }, sort: 'ordre:asc', limit: 100 });
  for (const r of transmis) {
    const existing = await findOneBy(strapi, 'api::depouillement-rapport.depouillement-rapport', { rapportRequis: { documentId: r.documentId } });
    if (!existing) {
      await strapi.documents('api::depouillement-rapport.depouillement-rapport').create({
        data: { rapportRequis: { connect: [r.documentId] }, statut: 'a_depouiller', valeurs: { empT: '', empF: '', empJ: '', empR: '', benef: '', inv: '', incidents: 0, note: '' } },
      });
    }
  }
  // Le rapport technique T1 (transmis) : depouillement PROPOSE avec valeurs de demo (a valider par l'UGP).
  const rapTech = transmis.find((r) => r.type?.code === 'technique') || transmis[0];
  if (rapTech) {
    const dep = await findOneBy(strapi, 'api::depouillement-rapport.depouillement-rapport', { rapportRequis: { documentId: rapTech.documentId } });
    const cabinet = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: 'demo-instructeur@subco-prete.bi' } });
    if (dep && dep.statut === 'a_depouiller') {
      await strapi.documents('api::depouillement-rapport.depouillement-rapport').update({
        documentId: dep.documentId,
        data: { statut: 'propose', saisiPar: cabinet ? { connect: [cabinet.id] } : null, proposeLe: '2027-02-11T09:00:00.000Z', valeurs: { empT: 18, empF: 10, empJ: 6, empR: 1, benef: 210, inv: 21000, incidents: 1, note: 'Deversement mineur maitrise — signale, mesures prises.' } },
      });
    }
  }
  // Valeur saisie externe : plaintes = 1 (source MGP projet, K5).
  const indPlaintes = await findOneBy(strapi, 'api::indicateur.indicateur', { code: 'es_plaintes' });
  if (indPlaintes && !(await findOneBy(strapi, 'api::valeur-indicateur-saisie.valeur-indicateur-saisie', { indicateur: { documentId: indPlaintes.documentId } }))) {
    await strapi.documents('api::valeur-indicateur-saisie.valeur-indicateur-saisie').create({
      data: { indicateur: { connect: [indPlaintes.documentId] }, periode: '2026', valeur: 1, source: 'MGP projet', saisiLe: '2026-07-10T09:00:00.000Z' },
    });
  }
}

async function ensureNonObjectionDemo(strapi) {
  const OBJ = 'Derogation — extension du delai de completude C1';
  if (await findOneBy(strapi, 'api::non-objection.non-objection', { objet: OBJ })) return;
  const casE = await findOneBy(strapi, 'api::cas-non-objection.cas-non-objection', { code: 'e' });
  const pieceId = await uploadDemoPieceImage(strapi, 'Demande redigee (derogation)');
  await strapi.documents('api::non-objection.non-objection').create({
    data: {
      type: casE ? connectRelation(casE) : null,
      objet: OBJ, reference: '—', requise: false, version: 1,
      statut: 'transmise', dateTransmission: '2026-07-02',
      demandeRedigee: pieceId || null,
    },
  });
}

async function resetSingletonByAppel(strapi, uid, appel, data) {
  const existing = await findOneBy(strapi, uid, { appel: { documentId: appel.documentId } });
  if (existing?.documentId) await strapi.documents(uid).update({ documentId: existing.documentId, data });
  else await strapi.documents(uid).create({ data: { appel: connectRelation(appel), ...data } });
}

// M5 phase 4 — Assistance cote equipe (§19, A.4) : complete la demo operateur pour
// couvrir la file interne : 1 en_cours PRISE EN CHARGE (top-up de la demande existante),
// 1 ouverte NON PRISE liee a une candidature, 1 ouverte liee a une subvention,
// 1 resolue (existante). Idempotent (guards par objet / champ vide).
async function ensureAssistanceEquipeDemo(strapi) {
  const UID_DEM = 'api::demande-assistance.demande-assistance';
  const UID_MSG = 'api::message-assistance.message-assistance';

  const ugpUser = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: 'demo-ugp@subco-prete.bi' } });

  // 1. Top-up : la demande en cours de la demo operateur devient « prise en charge » (H1).
  const enCours = await findOneBy(strapi, UID_DEM, { objet: "Je n'arrive pas a joindre mon etat financier" });
  if (enCours && ugpUser) {
    const populated = await strapi.documents(UID_DEM).findOne({ documentId: enCours.documentId, populate: { priseEnChargePar: true } });
    if (!populated?.priseEnChargePar) {
      await strapi.documents(UID_DEM).update({ documentId: enCours.documentId, data: { priseEnChargePar: { connect: [ugpUser.id] } } });
    }
  }

  const [catCandidature, catSubvention] = await Promise.all([
    findOneBy(strapi, 'api::categorie-assistance.categorie-assistance', { code: 'ma_candidature' }),
    findOneBy(strapi, 'api::categorie-assistance.categorie-assistance', { code: 'ma_subvention' }),
  ]);

  // 2. Ouverte NON PRISE, liee a une candidature (demo-candidat).
  const OBJ_CONTREPARTIE = 'Comment corriger le montant de ma contrepartie ?';
  if (!(await findOneBy(strapi, UID_DEM, { objet: OBJ_CONTREPARTIE }))) {
    const userA = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_EMAIL } });
    const candidature = userA
      ? await strapi.documents('api::candidature.candidature').findFirst({ filters: { owner: { id: userA.id }, titreProjet: 'Unite de sechage de mangues' } })
      : null;
    if (userA) {
      const demande = await strapi.documents(UID_DEM).create({
        data: {
          owner: userA.id,
          objet: OBJ_CONTREPARTIE,
          categorie: connectRelation(catCandidature),
          concerneCandidature: connectRelation(candidature),
          statut: 'ouverte',
          origine: 'operateur',
        },
      });
      await strapi.documents(UID_MSG).create({
        data: {
          demande: connectRelation(demande),
          auteur: 'operateur',
          corps: "J'ai saisi 15 % au lieu de 20 % a l'etape financement. Comment corriger avant la soumission ?",
          envoyeLe: '2026-07-12T09:20:00.000Z',
        },
      });
    }
  }

  // 3. Ouverte, liee a la subvention active (demo-beneficiaire).
  const OBJ_DECAISSEMENT = 'Quand vais-je recevoir le prochain decaissement ?';
  if (!(await findOneBy(strapi, UID_DEM, { objet: OBJ_DECAISSEMENT }))) {
    const userB = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: 'demo-beneficiaire@subco-prete.bi' } });
    const subvention = userB
      ? await strapi.documents('api::subvention.subvention').findFirst({ filters: { owner: { id: userB.id }, statut: 'active' } })
      : null;
    if (userB) {
      const demande = await strapi.documents(UID_DEM).create({
        data: {
          owner: userB.id,
          objet: OBJ_DECAISSEMENT,
          categorie: connectRelation(catSubvention),
          concerneSubvention: connectRelation(subvention),
          statut: 'ouverte',
          origine: 'operateur',
        },
      });
      await strapi.documents(UID_MSG).create({
        data: {
          demande: connectRelation(demande),
          auteur: 'operateur',
          corps: "Ma demande N\u00b004 a ete approuvee — sous quel delai le paiement au fournisseur intervient-il ?",
          envoyeLe: '2026-07-12T16:10:00.000Z',
        },
      });
    }
  }
}

module.exports = {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  ensureDemoPortalData,
  ensureGestionDemoData,
  ensureEvaluationDemoData,
  ensureComiteDemoData,
  ensureAssistanceEquipeDemo,
  ensureNonObjectionDemo,
  ensureSeDemo,
  ensurePortalRolesAndSettings,
  ensureReferentials,
  setPermission,
};
