/*
 * Source unique des métadonnées de la rubrique « Documents & ressources ».
 * Utilisé par populate-resource-documents.js (local) et push-resource-documents.js (prod).
 * title, category (enum resource-document), description, file (PDF source), fileName (nom public).
 */
module.exports = [
  {
    file: '00-manuel.pdf',
    fileName: 'PRETE_Manuel-gestion-subventions-contrepartie.pdf',
    title: 'Manuel de gestion des subventions de contrepartie',
    category: 'manuel',
    description:
      "Document de référence du mécanisme de subventions de contrepartie du programme PRETE : gouvernance, éligibilité, processus d'octroi, gestion fiduciaire, conformité environnementale et sociale, suivi-évaluation et annexes opérationnelles.",
  },
  {
    file: 'annexe-01.pdf',
    fileName: 'PRETE_Annexe-01_Termes-de-reference-appel-a-propositions.pdf',
    title: "Annexe 1 : Termes de référence de l'appel à propositions de projets",
    category: 'tdr',
    description:
      "Termes de référence détaillant l'objet, les conditions de participation, les critères d'éligibilité et de sélection ainsi que les modalités de soumission de l'appel à propositions de projets.",
  },
  {
    file: 'annexe-02.pdf',
    fileName: 'PRETE_Annexe-02_Avis-appel-a-projets.pdf',
    title: "Annexe 2 : Avis d'appel à projets",
    category: 'appel',
    description:
      "Avis public annonçant l'ouverture de l'appel à projets : publics cibles, filières concernées, calendrier et modalités de dépôt des candidatures.",
  },
  {
    file: 'annexe-03.pdf',
    fileName: 'PRETE_Annexe-03_Modele-convention-subvention.pdf',
    title: 'Annexe 3 : Modèle de convention de subvention de contrepartie',
    category: 'modele',
    description:
      "Modèle type de la convention signée entre l'UGP PRETE et le bénéficiaire : engagements des parties, modalités de décaissement, obligations environnementales et sociales et annexes contractuelles.",
  },
  {
    file: 'annexe-04.pdf',
    fileName: 'PRETE_Annexe-04_Modele-plan-affaires-simplifie.pdf',
    title: "Annexe 4 : Modèle de plan d'affaires simplifié",
    category: 'modele',
    description:
      "Canevas type du plan d'affaires simplifié à joindre au dossier de candidature : présentation du projet, analyse du marché, modèle économique et plan de financement.",
  },
  {
    file: 'annexe-05.pdf',
    fileName: 'PRETE_Annexe-05_Grille-evaluation-eligibilite.pdf',
    title: "Annexe 5 : Grille d'évaluation de l'éligibilité",
    category: 'grille',
    description:
      "Grille de vérification des critères obligatoires d'éligibilité du candidat et de l'infrastructure, utilisée lors de la phase de présélection.",
  },
  {
    file: 'annexe-06.pdf',
    fileName: 'PRETE_Annexe-06_Grille-evaluation-technique.pdf',
    title: "Annexe 6 : Grille d'évaluation technique",
    category: 'grille',
    description:
      "Grille de notation des critères techniques servant à l'évaluation et au classement des projets présélectionnés.",
  },
  {
    file: 'annexe-07.pdf',
    fileName: 'PRETE_Annexe-07_Engagement-financement-contrepartie.pdf',
    title: 'Annexe 7 : Engagement de financement de la contrepartie',
    category: 'formulaire',
    description:
      "Déclaration par laquelle le candidat s'engage à mobiliser sa contrepartie financière et à en fournir les preuves. À compléter et signer par le représentant habilité.",
  },
  {
    file: 'annexe-08.pdf',
    fileName: 'PRETE_Annexe-08_Declaration-conflit-interet-confidentialite.pdf',
    title: "Annexe 8 : Déclaration d'absence de conflit d'intérêt et de confidentialité",
    category: 'formulaire',
    description:
      "Déclaration d'impartialité, de confidentialité et d'absence de conflit d'intérêts à signer par les parties prenantes du processus de sélection.",
  },
  {
    file: 'annexe-09.pdf',
    fileName: 'PRETE_Annexe-09_Liste-documents-dossier-soumission.pdf',
    title: 'Annexe 9 : Liste des documents du dossier de soumission',
    category: 'guide',
    description:
      "Liste de contrôle des pièces constitutives du dossier de soumission, permettant de vérifier la complétude de la candidature avant dépôt.",
  },
  {
    file: 'annexe-10.pdf',
    fileName: 'PRETE_Annexe-10_Fiche-pre-identification-projets.pdf',
    title: 'Annexe 10 : Fiche de pré-identification des projets',
    category: 'formulaire',
    description:
      "Fiche standard de pré-identification du projet en amont de la candidature : description sommaire, localisation et filière concernée.",
  },
];
