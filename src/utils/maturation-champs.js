'use strict';

// Catalogue des champs du formulaire qu'une campagne « Modifier le formulaire » peut rouvrir.
//
// POURQUOI UN CATALOGUE ET PAS UN CHAMP LIBRE. Une campagne ouvre un chemin d'ecriture vers
// `donneesProjet` d'un dossier deja depose, note et passe au Comite. Laisser saisir une cle
// arbitraire reviendrait a offrir une ecriture non bornee sur ces donnees. Le catalogue dit
// ce qui est ouvrable, avec son type et ses valeurs admises ; tout le reste est refuse.
//
// CE QUI N'Y FIGURE PAS, ET POURQUOI. La chaine de valeur, la province et la commune du site
// sont des couples identifiant + libelle en cascade, et surtout ils determinent l'eligibilite
// et la notation — figee depuis le 5 octobre et validee par le Comite le 20. Les rouvrir par
// une campagne permettrait de changer retroactivement ce sur quoi le Comite s'est prononce.
// Meme raison pour le volet E&S, qui porte une barriere d'eligibilite. Les y ajouter demande
// une decision explicite, pas un effet de bord.
//
// SOURCE UNIQUE. Le meme catalogue sert a composer la campagne, a valider le perimetre, a
// afficher le formulaire de l'operateur et a ecrire la valeur : aucun des quatre ne peut
// deriver des trois autres.

const UID_TYPE_CONTREPARTIE = 'api::type-contrepartie.type-contrepartie';

const OUI_NON = ['Oui', 'Non'];
const STATUTS_SITE = ['Propriete', 'Bail / location', 'Mis a disposition', 'A securiser'];
const MATURITES = ['Mature', 'Semi-mature', 'Embryonnaire'];

// `type` gouverne l'affichage ET la validation :
//   montant   — entier positif en BIF, saisi avec ou sans espaces
//   nombre    — entier >= 0
//   texte     — une ligne
//   texteLong — plusieurs lignes (`max` borne la longueur quand le formulaire la borne)
//   choix     — liste fermee ; `options` fixes, ou `optionsDe` a charger au referentiel
const CATALOGUE = [
  // --- Financement ---
  { cle: 'financement.budgetTotal', libelle: 'Budget total du projet (BIF)', section: 'Financement', type: 'montant', groupe: 'montants' },
  { cle: 'financement.contrepartie', libelle: 'Contrepartie mobilisee (BIF)', section: 'Financement', type: 'montant', groupe: 'montants' },
  { cle: 'financement.typeContrepartie', libelle: 'Type de contrepartie', section: 'Financement', type: 'choix', optionsDe: 'typeContrepartie' },
  { cle: 'financement.modeleEconomique', libelle: 'Modele economique', section: 'Financement', type: 'texteLong' },

  // --- Projet ---
  { cle: 'projet.typeInfrastructure', libelle: "Type d'infrastructure a realiser", section: 'Projet', type: 'texteLong' },
  { cle: 'projet.statutSite', libelle: 'Statut du site', section: 'Projet', type: 'choix', options: STATUTS_SITE },
  { cle: 'projet.usageCollectif', libelle: 'Usage collectif ou partage', section: 'Projet', type: 'choix', options: OUI_NON },
  { cle: 'projet.mpmeDesservies', libelle: 'MPME / acteurs desservis', section: 'Projet', type: 'nombre' },
  { cle: 'projet.maturite', libelle: 'Niveau de maturite', section: 'Projet', type: 'choix', options: MATURITES },
  { cle: 'projet.noteConceptuelle', libelle: 'Note conceptuelle', section: 'Projet', type: 'texteLong', max: 600 },

  // --- Impact et inclusion ---
  { cle: 'impact.mpme', libelle: 'MPME beneficiaires', section: 'Impact et inclusion', type: 'nombre' },
  { cle: 'impact.femmes', libelle: 'Femmes', section: 'Impact et inclusion', type: 'nombre' },
  { cle: 'impact.jeunes', libelle: 'Jeunes', section: 'Impact et inclusion', type: 'nombre' },
  { cle: 'impact.refugies', libelle: 'Refugies', section: 'Impact et inclusion', type: 'nombre' },
  { cle: 'impact.emplois', libelle: 'Emplois crees', section: 'Impact et inclusion', type: 'nombre' },
  { cle: 'impact.porteParFemme', libelle: 'Projet porte par une femme', section: 'Impact et inclusion', type: 'choix', options: OUI_NON },
  { cle: 'impact.zoneRurale', libelle: 'Zone rurale ou fragile', section: 'Impact et inclusion', type: 'choix', options: OUI_NON },

  // --- Environnement et social ---
  // Integre le 2 novembre a la demande du Cabinet : ces aspects ne se precisent qu'a la
  // descente sur le terrain, et n'ont donc pas pese dans la selection. Les reponses vivent
  // dans un TABLEAU `es.reponses[{libelle, reponse}]`, pas dans des champs plats : chaque
  // entree porte le libelle qui l'y retrouve.
  { cle: 'es.travaux', libelle: 'Travaux ou construction', section: 'Environnement et social', type: 'choix', options: OUI_NON, esLibelle: 'Travaux ou construction' },
  { cle: 'es.pollution', libelle: 'Pollution, dechets ou nuisances', section: 'Environnement et social', type: 'choix', options: OUI_NON, esLibelle: 'Pollution, déchets ou nuisances' },
  { cle: 'es.foncier', libelle: 'Acquisition fonciere ou deplacement', section: 'Environnement et social', type: 'choix', options: OUI_NON, esLibelle: 'Acquisition foncière ou déplacement' },

  // --- Operateur ---
  { cle: 'operateur.nif', libelle: "Numero d'identification fiscale (NIF)", section: 'Operateur', type: 'texte' },
  { cle: 'operateur.rc', libelle: 'RC / enregistrement', section: 'Operateur', type: 'texte' },
  { cle: 'operateur.telephone', libelle: 'Telephone', section: 'Operateur', type: 'texte' },
  { cle: 'operateur.email', libelle: 'Email de contact', section: 'Operateur', type: 'texte' },
];

const PAR_CLE = new Map(CATALOGUE.map((c) => [c.cle, c]));

// Les deux montants forment UN objet arithmetique : budget, contrepartie et subvention sont
// lies. Ouvrir l'un sans l'autre n'aurait pas de sens — accepter un nouveau budget en gardant
// l'ancienne contrepartie changerait la subvention a l'insu de tous.
const MONTANTS = ['financement.budgetTotal', 'financement.contrepartie'];

/** Catalogue affichable, options de referentiel resolues. */
async function catalogueChamps(strapi) {
  let typesContrepartie = [];
  try {
    const liste = await strapi.documents(UID_TYPE_CONTREPARTIE).findMany({ fields: ['libelle'], sort: ['ordre:asc'], limit: 50 });
    typesContrepartie = liste.map((t) => t.libelle).filter(Boolean);
  } catch (error) {
    strapi.log.warn(`[maturation] referentiel des contreparties illisible : ${error.message}`);
  }
  return CATALOGUE.map(({ optionsDe, ...champ }) => ({
    ...champ,
    ...(optionsDe === 'typeContrepartie' ? { options: typesContrepartie } : {}),
  }));
}

/**
 * Normalise la selection faite a l'ecran. Refuse une cle hors catalogue — c'est la garde qui
 * empeche une ecriture arbitraire dans `donneesProjet` — et impose le couple des montants.
 */
function normaliserChamps(cles) {
  const demandees = [...new Set((Array.isArray(cles) ? cles : []).map((c) => String(c || '').trim()).filter(Boolean))];
  const inconnue = demandees.find((c) => !PAR_CLE.has(c));
  if (inconnue) throw new Error(`Le champ « ${inconnue} » ne fait pas partie des champs modifiables.`);
  if (demandees.length === 0) throw new Error('Aucun champ a modifier n\'a ete choisi.');

  // Cocher un seul montant ouvre l'autre : ils ne se corrigent pas separement.
  const avecMontants = MONTANTS.some((m) => demandees.includes(m))
    ? [...new Set([...demandees, ...MONTANTS])]
    : demandees;

  // On conserve l'ordre du catalogue : le formulaire de l'operateur suit celui du depot.
  return CATALOGUE.filter((c) => avecMontants.includes(c.cle)).map((c) => c.cle);
}

/** Les champs d'un perimetre, decrits. Tolere les demandes anterieures au catalogue. */
function champsDuPerimetre(perimetre) {
  // Avant le 2 novembre, une campagne de montants portait un simple drapeau `montants`.
  // Les demandes deja parties le portent encore : leur perimetre est fige, on le lit tel quel.
  const cles = Array.isArray(perimetre?.champs) && perimetre.champs.length
    ? perimetre.champs
    : (perimetre?.montants ? [...MONTANTS, 'financement.typeContrepartie'] : []);
  return cles.map((c) => PAR_CLE.get(c)).filter(Boolean);
}

/**
 * Valeur actuelle d'un champ au dossier. Un accesseur unique, parce que tous les champs ne
 * vivent pas au meme endroit : la plupart sont plats (`financement.budgetTotal`), les
 * reponses E&S sont rangees dans un tableau et se retrouvent par leur libelle.
 */
function lireValeur(donneesProjet, cle) {
  const champ = PAR_CLE.get(cle);
  if (!champ) return null;
  if (champ.esLibelle) {
    const reponses = Array.isArray(donneesProjet?.es?.reponses) ? donneesProjet.es.reponses : [];
    return reponses.find((r) => r?.libelle === champ.esLibelle)?.reponse ?? null;
  }
  const [section, nom] = cle.split('.');
  return donneesProjet?.[section]?.[nom] ?? null;
}

function nombreOuNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Valide ce que l'operateur propose, champ par champ, contre le catalogue.
 * @returns {{valeurs: object, libelles: string[]}} valeurs indexees par cle pointee.
 */
function validerValeurs(perimetre, proposees) {
  const champs = champsDuPerimetre(perimetre);
  if (champs.length === 0) return { valeurs: {}, libelles: [] };
  const entrant = proposees && typeof proposees === 'object' ? proposees : {};

  const valeurs = {};
  for (const champ of champs) {
    const brut = entrant[champ.cle];
    if (brut === undefined || brut === null || String(brut).trim() === '') continue;

    if (champ.type === 'montant' || champ.type === 'nombre') {
      const n = nombreOuNull(brut);
      if (n === null) throw new Error(`« ${champ.libelle} » doit etre un nombre.`);
      if (n < 0) throw new Error(`« ${champ.libelle} » ne peut pas etre negatif.`);
      valeurs[champ.cle] = Math.round(n);
      continue;
    }
    if (champ.type === 'choix' && Array.isArray(champ.options) && champ.options.length) {
      // Le referentiel des contreparties peut avoir evolue depuis le depart de la demande :
      // on n'oppose pas une liste fermee a un operateur de bonne foi, on accepte sa valeur.
      valeurs[champ.cle] = String(brut).trim();
      continue;
    }
    const texte = String(brut).trim();
    if (champ.max && texte.length > champ.max) {
      throw new Error(`« ${champ.libelle} » depasse ${champ.max} caracteres.`);
    }
    valeurs[champ.cle] = texte;
  }

  // Le couple des montants : les deux, ou aucun.
  const ouvreMontants = champs.some((c) => MONTANTS.includes(c.cle));
  if (ouvreMontants) {
    const fournis = MONTANTS.filter((m) => valeurs[m] !== undefined);
    if (fournis.length === 1) throw new Error('Le budget total et la contrepartie sont tous deux requis.');
    if (fournis.length === 2 && valeurs['financement.contrepartie'] > valeurs['financement.budgetTotal']) {
      throw new Error('La contrepartie ne peut pas depasser le budget total.');
    }
  }

  return { valeurs, libelles: champs.map((c) => c.libelle) };
}

/** Applique les valeurs validees a une copie de `donneesProjet`. Ne mute pas l'original. */
function appliquerValeurs(donneesProjet, valeurs) {
  const sortie = { ...(donneesProjet || {}) };
  let esTouche = false;

  for (const [cle, valeur] of Object.entries(valeurs || {})) {
    const champ = PAR_CLE.get(cle);

    if (champ?.esLibelle) {
      const reponses = Array.isArray(sortie.es?.reponses) ? [...sortie.es.reponses] : [];
      const i = reponses.findIndex((r) => r?.libelle === champ.esLibelle);
      if (i >= 0) reponses[i] = { ...reponses[i], reponse: valeur };
      else reponses.push({ libelle: champ.esLibelle, reponse: valeur });
      sortie.es = { ...(sortie.es || {}), reponses };
      esTouche = true;
      continue;
    }

    const [section, nom] = cle.split('.');
    if (!section || !nom) continue;
    sortie[section] = { ...(sortie[section] || {}), [nom]: valeur };
  }

  // `risqueDeclare` n'est pas saisi, il se DEDUIT : un « oui » a l'une des trois questions
  // du screening le leve. Le recalculer ici evite qu'une reponse corrigee laisse derriere
  // elle un drapeau qui ne correspond plus a ce qui est ecrit juste a cote.
  if (esTouche) {
    const reponses = Array.isArray(sortie.es?.reponses) ? sortie.es.reponses : [];
    sortie.es = { ...sortie.es, risqueDeclare: reponses.some((r) => String(r?.reponse).toLowerCase() === 'oui') };
  }
  return sortie;
}

/**
 * Le screening est-il passe a « risque declare » sans qu'un PGES soit au dossier ?
 * On ne bloque pas la validation — l'equipe a vu la reponse et l'assume — mais le dossier
 * ne doit pas changer d'etat en silence : un plan de gestion devient attendu.
 */
function pgesDesormaisAttendu(avant, apres) {
  const risque = (d) => Boolean(d?.es?.risqueDeclare);
  return !risque(avant) && risque(apres) && !apres?.es?.pges?.fileId;
}

/** Les valeurs proposees, en clair — sans comparaison a l'existant. */
function decrireValeurs(valeurs) {
  return CATALOGUE
    .filter((c) => Object.prototype.hasOwnProperty.call(valeurs || {}, c.cle))
    .map((c) => `${c.libelle} : ${pourAffichage(valeurs[c.cle])}`);
}

/** Une valeur lisible dans une ligne de journal ou de courriel : jamais vide, jamais longue. */
function pourAffichage(v) {
  const t = String(v ?? '').trim();
  if (t === '') return 'non renseigne';
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** Ce qui a change, en clair, pour le journal. */
function resumerChangements(avant, valeurs) {
  const lignes = [];
  // `jsonb` renormalise l'ordre des cles : sans tri, le journal les enumere au hasard.
  // On suit l'ordre du catalogue, qui est celui du formulaire de depot.
  const ordonnees = CATALOGUE
    .map((c) => c.cle)
    .filter((c) => Object.prototype.hasOwnProperty.call(valeurs || {}, c))
    .map((c) => [c, valeurs[c]]);
  for (const [cle, apres] of ordonnees) {
    const champ = PAR_CLE.get(cle);
    const ancien = lireValeur(avant, cle);
    if (String(ancien ?? '') === String(apres)) continue;
    lignes.push(`${champ?.libelle || cle} : ${pourAffichage(ancien)} -> ${pourAffichage(apres)}`);
  }
  return lignes;
}

module.exports = {
  CATALOGUE,
  MONTANTS,
  catalogueChamps,
  decrireValeurs,
  lireValeur,
  pgesDesormaisAttendu,
  normaliserChamps,
  champsDuPerimetre,
  validerValeurs,
  appliquerValeurs,
  resumerChangements,
};
