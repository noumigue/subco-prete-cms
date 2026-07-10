'use strict';

// Seed « Ma subvention » (Lot 2) — referentiels + 2 subventions de demo multi-etats.
// User A (demo-candidat) : subvention en PREPARATION. User B (demo-beneficiaire) : subvention ACTIVE.

const { DEMO_EMAIL, DEMO_PASSWORD } = require('./portal-seed');

const DEMO_B_EMAIL = 'demo-beneficiaire@subco-prete.bi';

function connect(documentId) {
  return documentId ? { connect: [documentId] } : undefined;
}

async function findOneBy(strapi, uid, where) {
  const items = await strapi.documents(uid).findMany({ filters: where, limit: 1 });
  return items[0] || null;
}

async function upsert(strapi, uid, where, data) {
  const existing = await findOneBy(strapi, uid, where);
  if (existing?.documentId) {
    return strapi.documents(uid).update({ documentId: existing.documentId, data, status: 'published' });
  }
  return strapi.documents(uid).create({ data, status: 'published' });
}

async function ensureReferentielsDecaissement(strapi) {
  const modalites = [
    {
      code: 'paiement_direct',
      libelle: 'Paiement direct (UGP -> fournisseur)',
      ordre: 10,
      piecesRequises: [
        'Demande de paiement direct',
        'Contrat signe avec le fournisseur',
        'Facture originale',
        'PV de reception des biens / travaux / services',
        'Coordonnees bancaires du fournisseur',
      ],
    },
    {
      code: 'remboursement',
      libelle: 'Remboursement de depenses payees',
      ordre: 20,
      piecesRequises: [
        'Facture acquittee',
        'Preuve de paiement (virement, cheque, quittance)',
        'Contrat ou bon de commande',
        'PV de reception ou attestation de service rendu',
      ],
    },
    {
      code: 'avance',
      libelle: 'Avance (cas exceptionnel)',
      ordre: 30,
      piecesRequises: ['Plan de tresorerie', "Calendrier d'activites", 'Demande officielle de decaissement'],
    },
    {
      code: 'jalon',
      libelle: 'Paiement par jalon (selon avancement)',
      ordre: 40,
      piecesRequises: ["Rapport d'avancement", 'PV ou attestation', 'Validation technique'],
    },
  ];
  for (const row of modalites) {
    await upsert(strapi, 'api::modalite-decaissement.modalite-decaissement', { code: row.code }, row);
  }

  const typesRapport = [
    { code: 'technique', libelle: "Rapport technique d'avancement", ordre: 10 },
    { code: 'financier', libelle: 'Rapport financier', ordre: 20 },
    { code: 'es', libelle: 'Rapport environnemental et social', ordre: 30 },
    { code: 'indicateurs', libelle: 'Rapport indicateurs de resultats', ordre: 40 },
    { code: 'cloture', libelle: 'Rapport final de cloture', ordre: 50 },
  ];
  for (const row of typesRapport) {
    await upsert(strapi, 'api::type-rapport.type-rapport', { code: row.code }, row);
  }

  const etapes = [
    { code: 'signature', libelle: 'Signature de la convention', ordre: 10 },
    { code: 'demarrage', libelle: 'Demarrage du projet', ordre: 20 },
    { code: 'achevement', libelle: 'Achevement previsionnel', ordre: 30 },
    { code: 'reception_provisoire', libelle: 'Reception provisoire', ordre: 40 },
    { code: 'reception_definitive', libelle: 'Reception definitive', ordre: 50 },
    { code: 'cloture', libelle: 'Cloture technique, fiduciaire et E&S', ordre: 60 },
  ];
  for (const row of etapes) {
    await upsert(strapi, 'api::etape-contractuelle.etape-contractuelle', { code: row.code }, row);
  }

  const statuts = [
    { code: 'brouillon', libelleBeneficiaire: 'Brouillon', ordre: 10 },
    { code: 'soumise', libelleBeneficiaire: 'Soumise', ordre: 20 },
    { code: 'avis_technique', libelleBeneficiaire: 'Avis technique (Cabinet)', ordre: 30 },
    { code: 'avis_fiduciaire', libelleBeneficiaire: 'Avis fiduciaire (UGP)', ordre: 40 },
    { code: 'payee', libelleBeneficiaire: 'Payee', ordre: 50 },
    { code: 'rejetee', libelleBeneficiaire: 'Rejetee', ordre: 60 },
    { code: 'complements_requis', libelleBeneficiaire: 'Complements requis', ordre: 70 },
  ];
  for (const row of statuts) {
    await upsert(strapi, 'api::statut-demande.statut-demande', { code: row.code }, row);
  }
}

async function ensureUserB(strapi) {
  const userService = strapi.plugin('users-permissions').service('user');
  const candidatRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'candidat' } });

  let user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_B_EMAIL } });
  if (!user) {
    user = await userService.add({
      username: DEMO_B_EMAIL,
      email: DEMO_B_EMAIL,
      password: DEMO_PASSWORD,
      confirmed: true,
      blocked: false,
      provider: 'local',
      role: candidatRole.id,
      orgName: 'Cooperative Twungubumwe',
    });
  }

  await upsert(strapi, 'api::organisation.organisation', { nom: 'Cooperative Twungubumwe' }, {
    owner: user.id,
    nom: 'Cooperative Twungubumwe',
    adresse: 'Colline Gihanga, zone Rukaramu',
    telephone: '+257 79 22 33 44',
    contact: 'Responsable Twungubumwe',
  });

  return user;
}

async function ensureSubventionA(strapi) {
  const userA = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_EMAIL } });
  if (!userA) return;

  const existing = await findOneBy(strapi, 'api::subvention.subvention', { owner: { id: userA.id } });
  if (existing) return;

  const subvention = await strapi.documents('api::subvention.subvention').create({
    data: {
      owner: userA.id,
      statut: 'preparation',
      numeroConvention: null,
      montantTotal: 120000000,
      montantSubvention: 96000000,
      montantContrepartie: 24000000,
      montantDecaisse: 0,
    },
  });

  const conditions = [
    { libelle: 'Validation du screening environnemental et social', statut: 'validee', dateValidation: '2026-10-03', ordre: 10 },
    { libelle: 'Validation du budget detaille', statut: 'validee', dateValidation: '2026-10-05', ordre: 20 },
    { libelle: 'Preuve de mobilisation de la contrepartie', statut: 'action_requise', echeance: '2026-10-20', ordre: 30 },
    { libelle: 'Validation du plan de mise en oeuvre', statut: 'en_cours_ugp', ordre: 40 },
    { libelle: 'Autorisations administratives requises', statut: 'en_cours_ugp', ordre: 50 },
    { libelle: 'Attestation de Conformite prealable au Decaissement (ACD)', statut: 'en_cours_ugp', ordre: 60 },
  ];
  for (const row of conditions) {
    await strapi.documents('api::condition-prealable.condition-prealable').create({
      data: { ...row, subvention: connect(subvention.documentId) },
    });
  }
}

async function ensureSubventionB(strapi, userB) {
  const existing = await findOneBy(strapi, 'api::subvention.subvention', { owner: { id: userB.id } });
  if (existing) return;

  // La creation en `active` declenche le lifecycle -> role beneficiaire pour userB.
  const subvention = await strapi.documents('api::subvention.subvention').create({
    data: {
      owner: userB.id,
      statut: 'active',
      numeroConvention: 'PRETE-CV-C1-2026-0007',
      dateSignature: '2026-10-28',
      montantTotal: 120000000,
      montantSubvention: 96000000,
      montantContrepartie: 24000000,
      montantDecaisse: 28800000,
    },
  });
  const sid = connect(subvention.documentId);

  const docs = [
    ['A', 'Dossier de candidature approuve'],
    ['B', 'Description technique du projet'],
    ['C', 'Budget detaille & plan de financement'],
    ['D', 'Calendrier de mise en oeuvre'],
    ['E', 'Plan de decaissement'],
    ['F', 'Indicateurs de resultats'],
    ['G', 'Engagements environnementaux et sociaux'],
    ['H', 'Engagement de contrepartie'],
    ['I', "Plan d'exploitation et de maintenance"],
  ];
  for (const [lettre, titre] of docs) {
    await strapi.documents('api::document-contractuel.document-contractuel').create({
      data: { subvention: sid, lettre, titre },
    });
  }

  const etapeByCode = {};
  for (const code of ['signature', 'demarrage', 'achevement', 'reception_provisoire', 'reception_definitive', 'cloture']) {
    etapeByCode[code] = await findOneBy(strapi, 'api::etape-contractuelle.etape-contractuelle', { code });
  }
  const jalons = [
    { code: 'signature', datePrevue: '2026-10-28', dateReelle: '2026-10-28', ordre: 10 },
    { code: 'demarrage', datePrevue: '2026-11-15', dateReelle: '2026-11-15', ordre: 20 },
    { code: 'achevement', datePrevue: '2028-05-31', dateReelle: null, ordre: 30 },
    { code: 'reception_provisoire', datePrevue: '2028-06-30', dateReelle: null, ordre: 40 },
    { code: 'reception_definitive', datePrevue: '2028-09-30', dateReelle: null, ordre: 50 },
    { code: 'cloture', datePrevue: '2028-12-31', dateReelle: null, ordre: 60 },
  ];
  for (const j of jalons) {
    await strapi.documents('api::jalon-projet.jalon-projet').create({
      data: { subvention: sid, etape: connect(etapeByCode[j.code]?.documentId), datePrevue: j.datePrevue, dateReelle: j.dateReelle, ordre: j.ordre },
    });
  }

  const typeByCode = {};
  for (const code of ['technique', 'financier', 'es', 'indicateurs', 'cloture']) {
    typeByCode[code] = await findOneBy(strapi, 'api::type-rapport.type-rapport', { code });
  }
  const rapports = [
    { code: 'technique', periodeLibelle: 'T1', echeance: '2027-02-15', statut: 'transmis', dateTransmission: '2027-02-10', ordre: 10 },
    { code: 'financier', periodeLibelle: 'T1', echeance: '2027-02-15', statut: 'transmis', dateTransmission: '2027-02-10', ordre: 20 },
    { code: 'es', periodeLibelle: 'T1', echeance: '2027-02-15', statut: 'echu', ordre: 30 },
    { code: 'technique', periodeLibelle: 'T2', echeance: '2027-05-15', statut: 'a_venir', ordre: 40 },
    { code: 'cloture', periodeLibelle: 'Cloture', echeance: '2028-12-31', statut: 'a_venir', ordre: 50 },
  ];
  for (const r of rapports) {
    await strapi.documents('api::rapport-requis.rapport-requis').create({
      data: {
        subvention: sid,
        type: connect(typeByCode[r.code]?.documentId),
        periodeLibelle: r.periodeLibelle,
        echeance: r.echeance,
        statut: r.statut,
        dateTransmission: r.dateTransmission || null,
        ordre: r.ordre,
      },
    });
  }

  await strapi.documents('api::mesure-corrective.mesure-corrective').create({
    data: {
      subvention: sid,
      description: "Mise a jour du registre des utilisateurs de l'infrastructure demandee par l'UGP.",
      echeance: '2027-03-30',
      statut: 'en_cours',
    },
  });

  const statutByCode = {};
  for (const code of ['payee']) {
    statutByCode[code] = await findOneBy(strapi, 'api::statut-demande.statut-demande', { code });
  }
  const modaliteByCode = {};
  for (const code of ['avance', 'paiement_direct']) {
    modaliteByCode[code] = await findOneBy(strapi, 'api::modalite-decaissement.modalite-decaissement', { code });
  }

  const demandes = [
    {
      numero: 1,
      modalite: 'avance',
      montant: 14400000,
      objet: 'Avance initiale de demarrage.',
      statut: 'payee',
      aJustifier: true,
      justificationStatut: 'validee',
    },
    {
      numero: 2,
      modalite: 'paiement_direct',
      montant: 14400000,
      objet: 'Paiement direct du fournisseur du sechoir.',
      statut: 'payee',
      aJustifier: false,
      justificationStatut: 'non_requise',
    },
    {
      // N°03 : avance payee EN ATTENTE de justification (V3) -> bloque toute nouvelle demande (11.4).
      numero: 3,
      modalite: 'avance',
      montant: 14400000,
      objet: 'Avance de reconstitution.',
      statut: 'payee',
      aJustifier: true,
      justificationStatut: 'attendue',
    },
  ];
  for (const d of demandes) {
    await strapi.documents('api::demande-decaissement.demande-decaissement').create({
      data: {
        subvention: sid,
        numero: d.numero,
        modalite: connect(modaliteByCode[d.modalite]?.documentId),
        montant: d.montant,
        objet: d.objet,
        statut: connect(statutByCode[d.statut]?.documentId),
        aJustifier: d.aJustifier,
        justificationStatut: d.justificationStatut,
      },
    });
  }
}

async function ensureSubventionDemo(strapi) {
  await ensureReferentielsDecaissement(strapi);
  const userB = await ensureUserB(strapi);
  await ensureSubventionA(strapi);
  await ensureSubventionB(strapi, userB);
}

module.exports = { ensureSubventionDemo, DEMO_B_EMAIL };
