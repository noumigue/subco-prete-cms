#!/usr/bin/env node
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/core');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);
process.env.STRAPI_DISABLE_UPLOAD_PROVIDER ??= 'true';
process.env.STRAPI_SKIP_BOOTSTRAP_PERMISSIONS ??= 'true';

const faqItems = [
  {
    question: 'Qui peut candidater au programme SUBCO-PRETE ?',
    theme: 'eligibilite',
    ordre: 1,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "Tout opérateur légalement constitué au Burundi peut candidater, à condition de disposer d'un NIF et d'un RC valides, et d'être en règle avec ses obligations fiscales. Sont éligibles les entreprises (SARL, SA…), les coopératives agricoles ou de services, les associations professionnelles, les ONG à vocation économique, et les fournisseurs de services numériques. " },
          { text: 'Un seul critère non satisfait entraîne le rejet dès la présélection, sans évaluation technique.', bold: true },
        ],
      },
    ],
  },
  {
    question: "Mon projet doit s'inscrire dans quelle filière ?",
    theme: 'eligibilite',
    ordre: 2,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "Le projet doit s'inscrire dans l'une des " },
          { text: '5 filières prioritaires', bold: true },
          { text: ' : Fruits tropicaux, Volaille, Pisciculture, Lait ou Mines. Les projets transversaux couvrant plusieurs filières (logistique, certification, numérique, stockage) sont également éligibles sous validation de l’UGP PRETE.' },
        ],
      },
    ],
  },
  {
    question: 'Quels candidats et projets sont exclus du programme ?',
    theme: 'eligibilite',
    ordre: 3,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "Sont exclus les projets à usage exclusivement privé sans bénéfice collectif pour les MPME, les activités interdites par les politiques de la Banque mondiale, les dossiers frauduleux ou incomplets, et toute situation de conflit d'intérêts non déclarée. Les agents publics directement impliqués dans la gestion du mécanisme, les membres du Comité de sélection et leurs proches sont également exclus." },
        ],
      },
    ],
  },
  {
    question: 'Quels documents dois-je préparer pour mon dossier ?',
    theme: 'dossier',
    ordre: 1,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "Le dossier comprend : formulaire de candidature, documents juridiques (RC, NIF), attestation de conformité fiscale, états financiers, plan d'affaires simplifié, engagement de cofinancement (≥20%), liste des bénéficiaires MPME potentiels, fiche de screening E&S, déclaration d'absence de conflit d'intérêt. Tous les modèles sont téléchargeables dans la section Documents." },
        ],
      },
    ],
  },
  {
    question: 'Puis-je modifier mon dossier après soumission ?',
    theme: 'dossier',
    ordre: 2,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'Non — une fois soumis, le dossier est ' },
          { text: 'définitivement verrouillé', bold: true },
          { text: '. Si le cabinet identifie des pièces manquantes lors de la vérification administrative, il peut vous contacter pour des compléments dans un délai imparti. Vérifiez la complétude avant soumission à l’aide de la checklist disponible sur la plateforme.' },
        ],
      },
    ],
  },
  {
    question: 'Que se passe-t-il si je rate la date limite de dépôt ?',
    theme: 'dossier',
    ordre: 3,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'La date de clôture est ' },
          { text: 'strictement respectée', bold: true },
          { text: ' — aucun dossier ne peut être accepté après la date limite indiquée dans l’AMI, sans exception. Le programme fonctionnant par cohortes successives, inscrivez-vous aux notifications pour être alerté à l’ouverture du prochain AMI.' },
        ],
      },
    ],
  },
  {
    // K5 — Mecanisme de Gestion des Plaintes (MGP §13), distinct de l'assistance.
    // Placeholder a confirmer UGP (canaux officiels). Affiche cote operateur via faq-item.
    question: 'Comment déposer une plainte (mécanisme de gestion des plaintes) ?',
    theme: 'dossier',
    ordre: 4,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "Le Projet PRETE dispose d'un mécanisme de gestion des plaintes (MGP), distinct de l'assistance. Vous pouvez déposer une plainte, y compris de manière confidentielle, via les canaux officiels du projet " },
          { text: '(à confirmer par l’UGP : ligne téléphonique dédiée, adresse e-mail, points focaux)', bold: true },
          { text: ". Les plaintes sensibles (EAS/HS) sont traitées de façon confidentielle par un dispositif spécialisé." },
        ],
      },
    ],
  },
  {
    question: 'Quel est le montant maximum que je peux recevoir ?',
    theme: 'financement',
    ordre: 1,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'Le programme finance ' },
          { text: "jusqu'à 80%", bold: true },
          { text: ' du coût total de votre projet. Vous devez mobiliser au minimum ' },
          { text: '20%', bold: true },
          { text: ' en contrepartie. Exemple : pour un projet de 50 000 000 BIF, le programme peut financer jusqu’à 40 000 000 BIF et vous apportez au minimum 10 000 000 BIF.' },
        ],
      },
    ],
  },
  {
    question: 'Ma contrepartie doit-elle être en argent liquide ?',
    theme: 'financement',
    ordre: 2,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'Non. La contrepartie peut être apportée en numéraire, en nature (matériaux, terrain, main-d’œuvre valorisée), en équipements existants (machines, véhicules) ou en travaux préparatoires déjà réalisés. Toute forme autre que le numéraire doit être validée par l’UGP et justifiée dans le dossier.' },
        ],
      },
    ],
  },
  {
    question: 'Comment se déroulent les décaissements une fois sélectionné ?',
    theme: 'financement',
    ordre: 3,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'Les décaissements sont ' },
          { text: 'conditionnés à des jalons', bold: true },
          { text: ' de mise en œuvre validés par le cabinet et l’UGP — jalons techniques, fiduciaires et environnementaux. Les paiements peuvent être effectués directement aux fournisseurs, sur justificatifs, ou par tranches selon votre convention de subvention.' },
        ],
      },
    ],
  },
  {
    question: 'Sur quels critères mon projet sera-t-il noté ?',
    theme: 'selection',
    ordre: 1,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: "L'évaluation se fait sur 100 points : " },
          { text: 'Bloc A — Infrastructure (60 pts)', bold: true },
          { text: ' : Pertinence stratégique (15), Cohérence technique (10), Faisabilité (10), Viabilité économique (10), Impact socio-économique (10), Conformité E&S (5). ' },
          { text: 'Bloc B — Candidat (40 pts)', bold: true },
          { text: ' : Conformité juridique, capacité financière, capacité opérationnelle et gouvernance. Seuil minimal : ' },
          { text: '60/100', bold: true },
          { text: '.' },
        ],
      },
    ],
  },
  {
    question: 'Combien de temps dure le processus entre soumission et décision ?',
    theme: 'selection',
    ordre: 2,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'À partir de la clôture des dépôts (J) : analyse administrative J+10, évaluation technique J+25, délibération du Comité J+35, non-objection Banque mondiale J+45, publication des résultats J+35 à J+45. La décision est communiquée à tous les candidats avec une ' },
          { text: 'justification motivée', bold: true },
          { text: '.' },
        ],
      },
    ],
  },
  {
    question: 'Si je ne suis pas retenu, puis-je recandidater ?',
    theme: 'selection',
    ordre: 3,
    publie: true,
    reponse: [
      {
        type: 'paragraph',
        children: [
          { text: 'Oui — le rejet lors d’une cohorte n’est pas définitif. Vous recevrez un ' },
          { text: 'retour motivé', bold: true },
          { text: ' détaillant les points à améliorer. Vous pouvez intégrer ces retours et soumettre un dossier renforcé lors du prochain AMI.' },
        ],
      },
    ],
  },
];

function normalizeBlocks(value) {
  if (!Array.isArray(value)) return value;

  return value.map((node) => {
    if (!node || typeof node !== 'object') return node;

    const next = { ...node };
    if (typeof next.text === 'string' && !next.type) {
      next.type = 'text';
    }

    if (Array.isArray(next.children)) {
      next.children = normalizeBlocks(next.children);
    }

    return next;
  });
}

async function main() {
  const appContext = await compileStrapi({ cwd: projectRoot });
  const app = await createStrapi(appContext).load();
  const uid = 'api::faq-item.faq-item';

  try {
    const existing = await app.documents(uid).findMany({
      status: 'draft',
      pagination: { pageSize: 100 },
    });

    for (const item of existing) {
      if (item?.documentId) {
        await app.documents(uid).delete({ documentId: item.documentId });
      }
    }

    for (const item of faqItems) {
      const created = await app.documents(uid).create({
        data: {
          ...item,
          reponse: normalizeBlocks(item.reponse),
        },
      });
      await app.documents(uid).publish({ documentId: created.documentId });
      console.log(`FAQ créée: ${item.theme}#${item.ordre}`);
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
