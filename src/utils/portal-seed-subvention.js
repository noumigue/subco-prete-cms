'use strict';

// Seed « Ma subvention » (Lot 2) — referentiels + 2 subventions de demo multi-etats.
// User A (demo-candidat) : subvention en PREPARATION. User B (demo-beneficiaire) : subvention ACTIVE.

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const PDFDocument = require('pdfkit');

const { DEMO_EMAIL, DEMO_PASSWORD } = require('./portal-seed');

const DEMO_B_EMAIL = 'demo-beneficiaire@subco-prete.bi';

function connect(documentId) {
  return documentId ? { connect: [documentId] } : undefined;
}

// Petit PDF de demonstration (pour meubler les documents de la convention en demo).
function simplePdf(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 56, right: 56 } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#155446').text('SUBCO-PRETE');
    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(13).fillColor('#1f2d28').text(title);
    doc.moveDown(0.6).font('Helvetica').fontSize(10.5).fillColor('#5c6b64');
    (lines || []).forEach((l) => doc.text(l, { paragraphGap: 4 }));
    doc.moveDown(2).fontSize(9).fillColor('#9aa9a2')
      .text('Document de demonstration — Projet PRETE Nyunganira. En production, la piece officielle est jointe par l’UGP.');
    doc.end();
  });
}

async function uploadPdfBuffer(strapi, buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-cv-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: filename } },
      files: { filepath: tmpPath, originalFilename: filename, mimetype: 'application/pdf', size: buffer.length },
    });
    return uploaded;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
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
      // Pieces attendues pour JUSTIFIER une avance payee (11.3.2) — editable au CMS.
      piecesJustification: [
        "Rapport technique d'avancement",
        'Etat des depenses realisees',
        'Factures et preuves de paiement',
        'PV ou attestations de reception',
      ],
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

// Enrichissement idempotent de la subvention B (s'applique meme si elle existe deja) :
// candidature liee (remplit « Le projet »), PDF de convention + fichiers des documents A-I.
const DEMO_DONNEES_B = {
  etape: 4,
  operateur: { nif: '4002233445', rc: 'RC/BJM/2022/0512', email: DEMO_B_EMAIL, telephone: '+257 79 22 33 44' },
  projet: {
    filiere: 'Fruits tropicaux',
    typeInfrastructure: 'Unite de sechage de mangues',
    siteProvince: 'Bujumbura', siteCommune: 'Mukaza', memeSiege: true,
    statutSite: 'Propriete', usageCollectif: 'Oui', mpmeDesservies: '120', maturite: 'Mature',
    noteConceptuelle: "Unite de sechage de mangues au benefice de 120 MPME de la chaine de valeur fruits tropicaux.",
  },
  financement: { budgetTotal: 120000000, contrepartie: 24000000, typeContrepartie: 'Numeraire' },
  impact: { mpme: '120', femmes: '65', jeunes: '30', refugies: '12', emplois: '18', porteParFemme: 'Oui', zoneRurale: 'Oui' },
};

async function ensureSubventionBContent(strapi) {
  const userB = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_B_EMAIL } });
  if (!userB) return;

  const subvention = await strapi.documents('api::subvention.subvention').findFirst({
    filters: { owner: { id: userB.id } },
    populate: { candidature: true, pdfConvention: true, documentsContractuels: { populate: ['fichier'] } },
  });
  if (!subvention?.documentId) return;

  // 1. Candidature liee (pour que « Le projet » de la convention soit rempli).
  if (!subvention.candidature) {
    const [appel, statutSel, organisation] = await Promise.all([
      findOneBy(strapi, 'api::appel.appel', { codeCohorte: 'C1' }),
      findOneBy(strapi, 'api::statut-candidature.statut-candidature', { code: 'selectionne' }),
      findOneBy(strapi, 'api::organisation.organisation', { nom: 'Cooperative Twungubumwe' }),
    ]);
    const candidature = await upsert(strapi, 'api::candidature.candidature', { titreProjet: 'Unite de sechage de mangues' }, {
      owner: userB.id,
      appel: connect(appel?.documentId),
      organisation: connect(organisation?.documentId),
      titreProjet: 'Unite de sechage de mangues',
      statut: connect(statutSel?.documentId),
      numeroDossier: 'PRETE-AP-C1-2026-00031',
      dateDepot: '2026-07-10T09:00:00.000Z',
      donneesProjet: DEMO_DONNEES_B,
    });
    await strapi.documents('api::subvention.subvention').update({
      documentId: subvention.documentId,
      data: { candidature: connect(candidature.documentId) },
    });
  }

  // 2. PDF de convention + fichiers des documents contractuels (placeholder de demo partage).
  const docs = subvention.documentsContractuels || [];
  const needsDocs = docs.some((d) => !d.fichier);
  if (!subvention.pdfConvention || needsDocs) {
    const buffer = await simplePdf('Convention de subvention (specimen)', [
      `Numero : ${subvention.numeroConvention || ''}`,
      'Objet : convention type de subvention de contrepartie PRETE.',
      'Ce specimen illustre l’emplacement du document signe telecharge par le beneficiaire.',
    ]);
    const uploaded = await uploadPdfBuffer(strapi, buffer, `${subvention.numeroConvention || 'convention'}.pdf`);

    if (!subvention.pdfConvention && uploaded?.id) {
      await strapi.documents('api::subvention.subvention').update({
        documentId: subvention.documentId,
        data: { pdfConvention: uploaded.id },
      });
    }
    for (const d of docs) {
      if (!d.fichier && uploaded?.id) {
        await strapi.documents('api::document-contractuel.document-contractuel').update({
          documentId: d.documentId,
          data: { fichier: uploaded.id },
        });
      }
    }
  }
}

// Donnees de DEMO uniquement (les referentiels sont provisionnes separement, toujours).
async function ensureSubventionDemo(strapi) {
  const userB = await ensureUserB(strapi);
  await ensureSubventionA(strapi);
  await ensureSubventionB(strapi, userB);
  await ensureSubventionBContent(strapi);
}

// ============================================================================
// Phase 3 (actes de subvention côté UGP) — top-up idempotent des subventions de démo
// du Lot 2 pour rendre chaque acte UGP/Cabinet testable :
//  - préparation (demo-candidat) : marque des conditions « techniques » + un avis Cabinet ;
//  - active (demo-bénéficiaire) : 1 demande au stade avis technique (circuit) + 1 avance
//    dont la justification est déposée (à valider par l'UGP, règle 11.4).
// Réutilise les subventions existantes (ne recrée rien).
// ============================================================================
async function makePieceId(strapi, title, lines, filename) {
  const buffer = await simplePdf(title, lines);
  const uploaded = await uploadPdfBuffer(strapi, buffer, filename);
  return uploaded?.id || null;
}

async function ensureSubventionUgpDemo(strapi) {
  // Paramètre référentiel §11.5 (placeholder, aucun blocage codé dessus).
  const pd = await strapi.documents('api::parametres-decaissement.parametres-decaissement').findFirst({});
  if (pd?.documentId) {
    if (pd.delaiTraitementJours == null) await strapi.documents('api::parametres-decaissement.parametres-decaissement').update({ documentId: pd.documentId, data: { delaiTraitementJours: 10 } });
  } else {
    await strapi.documents('api::parametres-decaissement.parametres-decaissement').create({ data: { delaiTraitementJours: 10 } });
  }

  // 1) Préparation (demo-candidat) : 2 conditions techniques, dont une avec avis Cabinet déjà déposé.
  const userA = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_EMAIL } });
  if (userA) {
    const subA = await strapi.documents('api::subvention.subvention').findFirst({ filters: { owner: { id: userA.id }, statut: 'preparation' }, populate: ['conditionsPrealables'] });
    for (const c of subA?.conditionsPrealables || []) {
      const lib = c.libelle || '';
      if (/environnemental|plan de mise|autorisations/i.test(lib)) {
        const data = { technique: true };
        if (/autorisations/i.test(lib) && !c.avisTechnique) data.avisTechnique = 'favorable';
        await strapi.documents('api::condition-prealable.condition-prealable').update({ documentId: c.documentId, data });
      }
    }
  }

  // 2) Active (demo-bénéficiaire) : circuit décaissement + justification à valider.
  const userB = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: DEMO_B_EMAIL } });
  if (userB) {
    const subB = await strapi.documents('api::subvention.subvention').findFirst({ filters: { owner: { id: userB.id }, statut: 'active' }, populate: { demandes: { populate: ['statut'] } } });
    if (subB) {
      const [statutAvisTech, modalitePaiement] = await Promise.all([
        findOneBy(strapi, 'api::statut-demande.statut-demande', { code: 'avis_technique' }),
        findOneBy(strapi, 'api::modalite-decaissement.modalite-decaissement', { code: 'paiement_direct' }),
      ]);
      const demandes = subB.demandes || [];
      if (!demandes.some((d) => d.numero === 4)) {
        const pieceId = await makePieceId(strapi, 'Demande de paiement direct N°04', ['Contrat fournisseur', 'Facture originale', 'PV de reception'], 'demande-04.pdf');
        await strapi.documents('api::demande-decaissement.demande-decaissement').create({
          data: { subvention: connect(subB.documentId), numero: 4, modalite: connect(modalitePaiement?.documentId), montant: 22000000, objet: 'Paiement direct — equipement de froid.', statut: connect(statutAvisTech?.documentId), aJustifier: false, justificationStatut: 'non_requise', pieces: pieceId ? [pieceId] : undefined },
        });
      }
      const d3 = demandes.find((d) => d.numero === 3);
      if (d3 && d3.justificationStatut === 'attendue') {
        const jpId = await makePieceId(strapi, 'Justification avance N°03', ["Rapport d'avancement", 'Etat des depenses', 'Preuves de paiement', 'PV de reception'], 'justif-03.pdf');
        await strapi.documents('api::demande-decaissement.demande-decaissement').update({ documentId: d3.documentId, data: { justificationStatut: 'soumise', justificationPieces: jpId ? [jpId] : undefined } });
      }
    }
  }
}

module.exports = { ensureReferentielsDecaissement, ensureSubventionDemo, ensureSubventionUgpDemo, DEMO_B_EMAIL };
