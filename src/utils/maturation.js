'use strict';

// Demandes de mise a jour d'un dossier deja depose.
//
// POURQUOI UN AGREGAT A PART, ET PAS UN `complement` DE PLUS
// `complement` est une PIECE manquante, nee de l'instruction de completude, et toute la
// file d'instruction s'appuie dessus. Ce qui est demande ici est autre chose : un PAQUET
// — des pieces ET des montants — avec un perimetre ferme, une echeance qui fait basculer
// le dossier, et une validation. Entrelacer les deux aurait fait porter a l'instruction de
// 333 dossiers le risque d'une regression sur un mecanisme qui ne la concerne pas.
//
// LES TROIS REGLES DE FOND (arbitrees le 29 octobre 2026)
//  1. Les montants valides font foi. Le basculement se fait A LA VALIDATION, jamais a la
//     soumission : sans cela un operateur modifierait seul les chiffres de son projet.
//  2. Le Cabinet OU l'UGP valide — pas une chaine a deux temps. D'ou l'importance de
//     tracer QUI a valide, et l'idempotence : la premiere validation gagne.
//  3. Passe l'echeance, le dossier bascule dans un etat dedie avant le Comite. Cet etat
//     n'est PAS terminal : perdre un projet recommande sur un accident de calendrier
//     serait absurde.
//
// UNE CAMPAGNE = UN GENRE, JAMAIS UN MELANGE (arbitrage du 2 novembre 2026)
// Le Cabinet lance une campagne par element a completer, et chacune suit son cours : sa
// propre echeance, ses propres relances, sa propre validation. C'est ce qui permet a un
// operateur de livrer « progressivement » sans qu'aucun etat intermediaire soit a inventer
// — une campagne se clot quand son objet est servi, independamment des deux autres.
//
// Trois genres, et un seul par demande :
//   champs          — mettre a jour des donnees deja saisies (ce soir : les montants)
//   piece_nouvelle  — joindre une piece d'un type qui n'existait pas au depot
//   piece_revision  — joindre une nouvelle version d'une piece existante, SANS ecraser
//
// Le melange n'est pas interdit par discipline mais par construction : `verifierGenre`
// refuse la campagne si le type porte autre chose que ce que son genre autorise. Un type
// qui reclamerait a la fois des montants et une piece — comme le faisait le premier type
// seme — ne peut plus partir.
//
// RIEN N'EST RECOPIE DANS `donneesProjet` POUR LES GENRES PIECE. La demande EST le
// registre : elle porte le fichier, sa date, qui l'a validee. « On n'ecrase pas la version
// precedente » devient vrai par construction, et les donnees des 333 dossiers de la
// Cohorte 1 ne sont pas touchees. L'onglet « Pieces » lit cette source en plus des deux
// qu'il connaissait (depot et complement) — voir `piecesValideesParMaturation`.
//
// LE PERIMETRE EST FIGE A LA CREATION. On recopie dans la demande ce que le type autorise,
// au lieu de relire le type a chaque soumission : un referentiel modifie en cours de route
// ne doit pas elargir retroactivement ce qu'un operateur peut changer sur un dossier dont
// la note est figee depuis le 5 octobre et validee par le Comite le 20.

const { buildCandidaturePdf } = require('./portal-pdf');
const { journal } = require('./portal-instruction');
const { sendPortalNotification } = require('./portal-notify');
const { uploadPdfBuffer } = require('./portal-pdf-upload');
const {
  normaliserChamps,
  champsDuPerimetre,
  validerValeurs,
  appliquerValeurs,
  resumerChangements,
  decrireValeurs,
  pgesDesormaisAttendu,
  MONTANTS,
} = require('./maturation-champs');

const UID_DEMANDE = 'api::demande-maj.demande-maj';
const UID_TYPE = 'api::type-demande-maj.type-demande-maj';
const UID_CANDIDATURE = 'api::candidature.candidature';
const UID_DEPOT = 'api::depot-dossier.depot-dossier';
const UID_STATUT = 'api::statut-candidature.statut-candidature';

// Les deux relances retenues, plus l'avis de cloture. Ce dernier n'est pas une relance :
// c'est ce qui empeche le « je n'ai jamais ete prevenu » trois semaines plus tard.
const PALIERS_RELANCE = [
  { cle: 'J-3', heures: 72, libelle: 'dans trois jours' },
  { cle: 'J-1', heures: 24, libelle: 'demain' },
];

const STATUTS_OUVERTS = ['demandee', 'renvoyee'];

const GENRES = ['champs', 'piece_nouvelle', 'piece_revision'];

/**
 * Genre d'un type anterieur au champ. On le DEDUIT du perimetre plutot que d'imposer une
 * migration : une ligne de code contre un script, et aucun risque sur l'existant.
 */
function genreDeduit(type) {
  if (type?.genre && GENRES.includes(type.genre)) return type.genre;
  if (type?.montantsOuverts) return 'champs';
  return 'piece_revision';
}

// --- Outils -------------------------------------------------------------------------

/** Echeance a J + n jours OUVRES, a 23h59 heure de Bujumbura (UTC+2). */
function echeanceOuvree(joursOuvres, depuis = new Date()) {
  const d = new Date(depuis.getTime());
  let restants = Math.max(1, Number(joursOuvres) || 1);
  while (restants > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const jour = d.getUTCDay();
    if (jour !== 0 && jour !== 6) restants -= 1;
  }
  d.setUTCHours(21, 59, 0, 0); // 23h59 a Bujumbura
  return d.toISOString();
}

/**
 * Perimetre fige depuis le type. `pieces` porte les LIBELLES, pas les identifiants : le
 * referentiel des types de piece peut etre reordonne sans rendre illisible une demande
 * deja partie.
 */
function perimetreDepuisType(type) {
  // Deux provenances pour les pieces, et c'est voulu. `piecesAttendues` pointe le
  // referentiel de candidature (genre piece_revision : on revise une des 15 pieces).
  // `piecesLibres` porte un libelle seul, hors referentiel (genre piece_nouvelle) : creer
  // une entree au referentiel partage ferait apparaitre la piece dans l'ecran de
  // completude des 333 dossiers deposes et dans le formulaire de la cohorte suivante.
  const duReferentiel = (type?.piecesAttendues || []).map((p) => ({
    libelle: p.libelle,
    groupe: p.groupe || null,
    exigence: p.exigence || 'obligatoire',
    revision: true,
  }));
  const libres = (Array.isArray(type?.piecesLibres) ? type.piecesLibres : [])
    .filter((p) => p && p.libelle)
    .map((p) => ({
      libelle: String(p.libelle).trim(),
      groupe: p.groupe || null,
      exigence: p.exigence || 'obligatoire',
      revision: false,
    }));
  // Les champs sont normalises contre le catalogue : une cle hors catalogue est refusee ici,
  // avant que la campagne ne parte, et non au moment ou l'operateur repond.
  const champs = Array.isArray(type?.champsOuverts) && type.champsOuverts.length
    ? normaliserChamps(type.champsOuverts)
    : [];
  return {
    genre: genreDeduit(type),
    pieces: [...duReferentiel, ...libres],
    // `montants` reste calcule : il gouverne encore l'indicateur « montants matures » du
    // dossier, qui ne vaut que pour le budget et la contrepartie, pas pour les autres champs.
    montants: champs.some((c) => MONTANTS.includes(c)) || (champs.length === 0 && Boolean(type?.montantsOuverts)),
    champs,
    validationRequise: type?.validationRequise !== false,
  };
}

/**
 * Ce qu'une demande reclame, en une cle. C'est l'invariant a proteger : un operateur ne
 * doit jamais recevoir deux demandes OUVERTES portant sur le meme objet — il ne saurait pas
 * a laquelle il repond, et l'echeance de l'une ferait basculer son dossier pendant qu'il
 * traite l'autre. En revanche trois demandes sur trois objets DISTINCTS sont exactement ce
 * que le Cabinet veut lancer.
 *
 * La comparaison porte sur l'objet, pas sur le type : deux types differents qui reclament
 * la meme piece restent un doublon aux yeux de l'operateur.
 */
function cleObjet(perimetre) {
  if (!perimetre) return 'inconnu';
  if (perimetre.genre === 'champs' || perimetre.montants) return 'champs:montants';
  const piece = (perimetre.pieces || [])[0];
  return `piece:${String(piece?.libelle || '').trim().toLowerCase()}`;
}

/** Date en toutes lettres. « 2026-11-09 » dans un courriel a un candidat est illisible. */
function dateFr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Bujumbura' });
}

/**
 * Objet en quelques mots, pour un SUJET de courriel. Depuis que les campagnes sont
 * separees, un operateur recoit plusieurs messages le meme jour sur le meme dossier :
 * s'ils portent tous « Mise a jour demandee sur votre dossier X », il ne peut pas savoir
 * lequel concerne quoi. L'objet passe donc en tete du sujet.
 */
function libelleObjetCourt(perimetre) {
  if (!perimetre) return 'Mise a jour';
  if (perimetre.genre === 'champs' || perimetre.montants) {
    const champs = champsDuPerimetre(perimetre);
    if (champs.length === 1) return champs[0].libelle;
    return `${champs.length} informations du projet`;
  }
  const piece = (perimetre.pieces || [])[0];
  const nom = piece?.libelle || 'piece';
  return perimetre.genre === 'piece_revision' ? `« ${nom} » (nouvelle version)` : `« ${nom} »`;
}

/**
 * Ce qui est demande, en une phrase adressee a l'operateur. Le texte libre saisi par
 * l'equipe le remplace quand il y en a un : elle sait souvent POURQUOI elle demande, et
 * cette raison vaut mieux qu'une formule.
 */
function phraseDemande(perimetre, numero) {
  if (perimetre?.genre === 'piece_nouvelle') {
    const nom = (perimetre.pieces || [])[0]?.libelle || 'une piece';
    return `Il vous est demande de fournir la piece « ${nom} » sur votre dossier ${numero}.`;
  }
  if (perimetre?.genre === 'piece_revision') {
    const nom = (perimetre.pieces || [])[0]?.libelle || 'une piece';
    return `Il vous est demande de deposer une nouvelle version de « ${nom} » sur votre dossier ${numero}.\n`
      + 'La version que vous aviez deposee est conservee : la nouvelle s\'y ajoute.';
  }
  const champs = champsDuPerimetre(perimetre).map((c) => c.libelle);
  return `Il vous est demande de mettre a jour les informations suivantes de votre dossier ${numero} :\n`
    + `${champs.map((c) => `  - ${c}`).join('\n')}`;
}

/** Ce que la demande reclame, en clair. Sert au journal et aux ecrans. */
function libelleObjet(perimetre) {
  if (!perimetre) return 'mise a jour';
  if (perimetre.genre === 'champs' || perimetre.montants) {
    const champs = champsDuPerimetre(perimetre);
    if (champs.length === 0) return 'champs du formulaire';
    if (champs.length <= 3) return champs.map((c) => c.libelle).join(', ');
    return `${champs.slice(0, 2).map((c) => c.libelle).join(', ')} et ${champs.length - 2} autre(s) champ(s)`;
  }
  const piece = (perimetre.pieces || [])[0];
  const nom = piece?.libelle || 'piece';
  return perimetre.genre === 'piece_revision' ? `nouvelle version de « ${nom} »` : `« ${nom} »`;
}

/**
 * Refuse un type qui melange. Appelee a la CREATION de la campagne, pas a la soumission :
 * c'est au lancement qu'il faut arreter une demande mal formee, avant qu'un courriel ne
 * parte vers un operateur a qui on reclamerait deux choses d'un coup.
 */
function verifierGenre(type, perimetre) {
  const genre = perimetre.genre;
  const nbPieces = perimetre.pieces.length;
  const libelle = type?.libelle || 'ce type';

  if (!GENRES.includes(genre)) throw new Error(`Genre inconnu sur « ${libelle} » : ${genre}.`);

  if (genre === 'champs') {
    if (nbPieces > 0) {
      throw new Error(
        `« ${libelle} » demande des champs du formulaire ET ${nbPieces} piece(s). Une campagne ne porte qu'un seul objet : retirez les pieces de ce type, ou lancez une campagne de genre « piece ».`,
      );
    }
    if (perimetre.champs.length === 0 && !perimetre.montants) {
      throw new Error(`« ${libelle} » ne precise aucun champ a mettre a jour.`);
    }
    return;
  }

  if (perimetre.montants) {
    throw new Error(
      `« ${libelle} » reclame une piece ET ouvre les montants. Une campagne ne porte qu'un seul objet : lancez deux campagnes.`,
    );
  }
  if (nbPieces === 0) throw new Error(`« ${libelle} » ne precise aucune piece a fournir.`);
  if (nbPieces > 1) {
    throw new Error(
      `« ${libelle} » reclame ${nbPieces} pieces. Une campagne ne porte qu'une piece : lancez-en une par piece.`,
    );
  }
  const piece = perimetre.pieces[0];
  if (genre === 'piece_revision' && !piece.revision) {
    throw new Error(`« ${libelle} » revise une piece existante mais la designe hors referentiel.`);
  }
  if (genre === 'piece_nouvelle' && piece.revision) {
    throw new Error(
      `« ${libelle} » annonce une piece d'un type nouveau mais designe « ${piece.libelle} », qui existe deja au referentiel. Lancez une campagne de genre « nouvelle version ».`,
    );
  }
}

async function statutParCode(strapi, code) {
  return strapi.documents(UID_STATUT).findFirst({ filters: { code } });
}

async function poserStatut(strapi, candidatureDocumentId, code) {
  const statut = await statutParCode(strapi, code);
  if (!statut?.documentId) {
    strapi.log.warn(`[maturation] statut « ${code} » absent du referentiel — statut inchange`);
    return false;
  }
  await strapi.documents(UID_CANDIDATURE).update({
    documentId: candidatureDocumentId,
    data: { statut: { connect: [statut.documentId] } },
  });
  return true;
}

// --- Creation -----------------------------------------------------------------------

/**
 * Cree une demande par dossier. Idempotent par (candidature, campagne) : relancer une
 * campagne interrompue ne cree pas de doublon — meme garde que les campagnes d'e-mail.
 *
 * @returns {{creees: number, ignorees: string[], erreurs: Array}}
 */
async function creerDemandes(strapi, { typeDocumentId, candidatureDocumentIds, campagne, echeance, joursOuvres, demandeePar, texteDemande }) {
  const type = await strapi.documents(UID_TYPE).findOne({
    documentId: typeDocumentId,
    populate: { piecesAttendues: true },
  });
  if (!type?.documentId) throw new Error(`Type de demande introuvable : ${typeDocumentId}`);
  if (type.actif === false) throw new Error(`Le type « ${type.libelle} » est desactive.`);

  const perimetre = perimetreDepuisType(type);
  verifierGenre(type, perimetre);
  const messageEquipe = String(texteDemande || '').trim() || null;
  const echeanceFinale = echeance || echeanceOuvree(joursOuvres || type.delaiJoursDefaut || 5);
  const maintenant = new Date().toISOString();

  const creees = [];
  const ignorees = [];
  const erreurs = [];

  for (const documentId of candidatureDocumentIds) {
    try {
      const candidature = await strapi.documents(UID_CANDIDATURE).findOne({
        documentId,
        populate: { organisation: true, owner: { fields: ['id', 'email'] } },
      });
      if (!candidature?.documentId) {
        erreurs.push({ documentId, motif: 'dossier introuvable' });
        continue;
      }

      // Deux gardes distinctes. La premiere dedoublonne la campagne : relancer une
      // campagne interrompue ne cree pas de seconde demande sur les dossiers deja servis.
      const deja = await strapi.documents(UID_DEMANDE).findFirst({
        filters: { candidature: { documentId }, campagne },
      });
      if (deja?.documentId) {
        ignorees.push(candidature.numeroDossier || documentId);
        continue;
      }

      // La seconde interdit deux demandes ouvertes sur le MEME OBJET. Elle portait jusqu'au
      // 2 novembre sur le dossier entier, ce qui rendait impossible la decision du Cabinet :
      // lancer une campagne par element a completer. Trois objets distincts cohabitent
      // desormais ; le meme objet deux fois, jamais.
      const ouvertes = await strapi.documents(UID_DEMANDE).findMany({
        filters: { candidature: { documentId }, statut: { $in: [...STATUTS_OUVERTS, 'fournie'] } },
        fields: ['documentId', 'statut', 'perimetre'],
        limit: 50,
      });
      const doublon = ouvertes.find((d) => cleObjet(d.perimetre) === cleObjet(perimetre));
      if (doublon) {
        erreurs.push({
          documentId,
          numero: candidature.numeroDossier,
          motif: `une demande portant sur le meme objet est deja en cours (${doublon.statut})`,
        });
        continue;
      }

      const texteOperateur = messageEquipe || type.texteDemande || phraseDemande(perimetre, candidature.numeroDossier);

      const demande = await strapi.documents(UID_DEMANDE).create({
        data: {
          candidature: { connect: [documentId] },
          type: { connect: [type.documentId] },
          campagne: campagne || null,
          phase: type.phase || 'maturation',
          perimetre,
          texteDemande: messageEquipe || type.texteDemande || null,
          echeance: echeanceFinale,
          statut: 'demandee',
          montantsStatut: perimetre.montants ? 'attendu' : 'non_demande',
          piecesFournies: [],
          relancesEnvoyees: [],
          demandeePar: demandeePar || 'Equipe SUBCO-PRETE',
          demandeeLe: maintenant,
        },
      });

      // Le dossier entre en maturation : son etat le dit, pour le candidat comme pour la file.
      if ((type.phase || 'maturation') === 'maturation') {
        await poserStatut(strapi, documentId, 'maturation');
      }

      await journal(strapi, documentId, {
        auteurLibelle: demandeePar || 'Equipe SUBCO-PRETE',
        type: 'demande_maj',
        texte: `Demande de mise a jour — ${libelleObjet(perimetre)}, echeance le ${String(echeanceFinale).slice(0, 10)}.`,
      });

      await notifier(strapi, candidature, {
        sujet: `${libelleObjetCourt(perimetre)} — mise a jour demandee (dossier ${candidature.numeroDossier})`,
        corps: `${texteOperateur}\n\nVous avez jusqu'au ${dateFr(echeanceFinale)} pour y repondre depuis votre espace operateur.`,
      });

      creees.push(demande.documentId);
    } catch (error) {
      erreurs.push({ documentId, motif: error.message });
    }
  }

  return { creees: creees.length, documentIds: creees, ignorees, erreurs };
}

async function notifier(strapi, candidature, { sujet, corps }) {
  try {
    await sendPortalNotification(strapi, {
      candidature,
      userId: candidature.owner?.id || null,
      email: candidature.owner?.email || null,
      sujet,
      corps,
    });
  } catch (error) {
    strapi.log.warn(`[maturation] notification non envoyee (${candidature.numeroDossier}) : ${error.message}`);
  }
}

// --- Soumission par l'operateur -------------------------------------------------------

/**
 * Enregistre ce que l'operateur depose. Ne touche JAMAIS `donneesProjet` : tant que
 * l'equipe n'a pas valide, les montants officiels du dossier restent ceux du depot.
 */
async function soumettreDemande(strapi, demande, { pieces, montants, valeurs }) {
  if (!STATUTS_OUVERTS.includes(demande.statut)) {
    throw new Error('Cette demande n\'est plus ouverte.');
  }
  const perimetre = demande.perimetre || {};

  // Garde de perimetre : une piece hors de ce qui a ete demande est refusee, pas ignoree.
  const attendues = new Set((perimetre.pieces || []).map((p) => p.libelle));
  const fournies = (Array.isArray(pieces) ? pieces : []).filter((p) => p && p.libelle);
  const intruse = fournies.find((p) => !attendues.has(p.libelle));
  if (intruse) throw new Error(`La piece « ${intruse.libelle} » ne fait pas partie de la demande.`);

  // Les valeurs arrivent indexees par cle pointee (`financement.budgetTotal`). L'ancienne
  // forme — un objet `montants` a plat — reste acceptee : des demandes parties avant le
  // 2 novembre vivent encore, et leur formulaire poste ainsi.
  let valeursProposees = demande.valeursProposees || null;
  let montantsProposes = demande.montantsProposes || null;
  let montantsStatut = demande.montantsStatut;

  const entrant = { ...(valeurs && typeof valeurs === 'object' ? valeurs : {}) };
  if (montants && typeof montants === 'object') {
    if (montants.budgetTotal !== undefined) entrant['financement.budgetTotal'] = montants.budgetTotal;
    if (montants.contrepartie !== undefined) entrant['financement.contrepartie'] = montants.contrepartie;
    if (montants.typeContrepartie) entrant['financement.typeContrepartie'] = montants.typeContrepartie;
  }

  if (Object.keys(entrant).length > 0) {
    const { valeurs: validees } = validerValeurs(perimetre, entrant);
    if (Object.keys(validees).length > 0) {
      valeursProposees = { ...(valeursProposees || {}), ...validees };
      montantsStatut = 'propose';
      // `montantsProposes` continue d'etre renseigne quand le couple est servi : les ecrans
      // et les demandes anterieures le lisent encore.
      if (validees['financement.budgetTotal'] !== undefined && validees['financement.contrepartie'] !== undefined) {
        montantsProposes = {
          budgetTotal: validees['financement.budgetTotal'],
          contrepartie: validees['financement.contrepartie'],
          typeContrepartie: validees['financement.typeContrepartie'] || montants?.typeContrepartie || null,
          commentaire: (montants && montants.commentaire) || null,
        };
      }
    }
  }

  const pieceDeja = new Map((demande.piecesFournies || []).map((p) => [p.libelle, p]));
  for (const p of fournies) {
    pieceDeja.set(p.libelle, {
      libelle: p.libelle,
      fileId: p.fileId || null,
      nomFichier: p.nomFichier || null,
      deposeLe: new Date().toISOString(),
      statut: 'fournie',
    });
  }

  const misAJour = await strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: {
      statut: 'fournie',
      soumisLe: new Date().toISOString(),
      piecesFournies: [...pieceDeja.values()],
      valeursProposees,
      montantsProposes,
      montantsStatut,
      motifRenvoi: null,
    },
  });

  // La reponse de l'operateur n'etait pas journalisee : on tracait la demande et la
  // validation, mais pas le depot entre les deux. Avec trois campagnes vivant en parallele
  // sur un meme dossier, cette ligne est ce qui permet de lire l'ordre reel des faits.
  const candidatureId = demande.candidature?.documentId || demande.candidature;
  if (candidatureId) {
    const quoi = fournies.length > 0
      ? fournies.map((p) => `« ${p.libelle} »`).join(', ')
      : null;
    const montantsTexte = montantsStatut === 'propose' && valeursProposees
      ? `valeurs proposees — ${decrireValeurs(valeursProposees).join(' · ')}`
      : null;
    await journal(strapi, candidatureId, {
      auteurLibelle: 'Operateur',
      type: 'demande_maj_fournie',
      texte: `Reponse deposee — ${[quoi, montantsTexte].filter(Boolean).join(' · ') || libelleObjet(perimetre)}.`,
    });
  }

  return misAJour;
}

// --- Validation -----------------------------------------------------------------------

/**
 * Valide la demande et, si des montants etaient attendus, les porte dans le dossier.
 *
 * Les montants forment UN SEUL objet arithmetique : budget total, contrepartie et
 * subvention sont lies. On les valide en bloc, jamais piece par piece — accepter un
 * nouveau budget total en refusant la contrepartie ne voudrait rien dire.
 *
 * ORDRE IMPERATIF, repris du re-depot : le PDF est produit AVANT toute ecriture. Si sa
 * generation echoue, rien n'est ecrit et le dossier reste dans sa version precedente.
 */
async function validerDemande(strapi, demande, { par, role }) {
  if (demande.statut === 'validee') {
    // Deux personnes peuvent valider : la premiere gagne, la seconde ne casse rien.
    return { demande, dejaValidee: true };
  }
  if (demande.statut !== 'fournie') {
    throw new Error('Seule une demande fournie peut etre validee.');
  }

  const candidature = await strapi.documents(UID_CANDIDATURE).findOne({
    documentId: demande.candidature?.documentId || demande.candidature,
    populate: { organisation: true, appel: true, owner: { fields: ['id', 'email'] }, pdfPermanent: true },
  });
  if (!candidature?.documentId) throw new Error('Dossier introuvable.');

  const maintenant = new Date().toISOString();
  const perimetre = demande.perimetre || {};
  let versionProduite = null;
  let changementsValides = [];

  // Valeurs a porter au dossier. Les demandes anterieures au catalogue ne portent qu'un
  // `montantsProposes` a plat : on le relit sous la forme pointee plutot que de les migrer.
  const valeursAPorter = demande.valeursProposees && Object.keys(demande.valeursProposees).length
    ? demande.valeursProposees
    : (demande.montantsProposes
      ? {
        'financement.budgetTotal': demande.montantsProposes.budgetTotal,
        'financement.contrepartie': demande.montantsProposes.contrepartie,
        ...(demande.montantsProposes.typeContrepartie
          ? { 'financement.typeContrepartie': demande.montantsProposes.typeContrepartie }
          : {}),
      }
      : {});

  if (Object.keys(valeursAPorter).length > 0) {
    const ancien = candidature.donneesProjet || {};
    const changements = resumerChangements(ancien, valeursAPorter);
    changementsValides = changements;
    const nouveau = appliquerValeurs(ancien, valeursAPorter);

    const versionSuivante = (Number(candidature.versionDepot) || 1) + 1;
    let pdfFile = null;
    try {
      const buffer = await buildCandidaturePdf({
        candidature: { ...candidature, donneesProjet: nouveau },
        organisation: candidature.organisation,
        appel: candidature.appel,
        mode: 'permanent',
      });
      pdfFile = await uploadPdfBuffer(buffer, `${candidature.numeroDossier}-v${versionSuivante}.pdf`);
    } catch (error) {
      strapi.log.error('[maturation] Echec de generation du PDF', error);
    }
    if (!pdfFile?.id) {
      throw new Error("Le document de candidature n'a pas pu etre regenere. Le dossier reste dans sa version precedente ; reessayez dans un instant.");
    }

    await strapi.documents(UID_CANDIDATURE).update({
      documentId: candidature.documentId,
      data: {
        donneesProjet: nouveau,
        versionDepot: versionSuivante,
        dernierDepotLe: maintenant,
        pdfPermanent: pdfFile.id,
        versionReference: versionSuivante,
        // « Montants matures » ne vaut que pour le budget et la contrepartie : une campagne
        // qui corrige le nombre d'emplois ne rend pas le plan de financement arrete.
        ...(perimetre.montants ? { montantsMatures: true, montantsMaturesLe: maintenant } : {}),
      },
    });

    await strapi.documents(UID_DEPOT).create({
      data: {
        candidature: { connect: [candidature.documentId] },
        version: versionSuivante,
        deposeLe: maintenant,
        pdf: pdfFile.id,
        donneesProjet: nouveau,
        titreProjet: candidature.titreProjet || null,
        auteurLibelle: `Maturation — ${par || 'equipe'}`,
      },
    });

    versionProduite = versionSuivante;

    await journal(strapi, candidature.documentId, {
      auteurLibelle: par || 'Equipe SUBCO-PRETE',
      type: perimetre.montants ? 'montants_matures' : 'champs_maj_valides',
      texte: `${perimetre.montants
        ? (champsDuPerimetre(perimetre).length > 2 ? 'Montants matures et champs mis a jour' : 'Montants matures et valides')
        : 'Champs mis a jour'} : ${changements.join(', ') || 'aucun changement'} (version ${versionSuivante}).`,
    });

    // Un « oui » au screening leve le risque environnemental et social. On ne bloque pas la
    // validation — l'equipe a lu la reponse et l'assume — mais le dossier ne change pas
    // d'etat en silence : le plan de gestion devient attendu, et le journal le dit.
    if (pgesDesormaisAttendu(ancien, nouveau)) {
      await journal(strapi, candidature.documentId, {
        auteurLibelle: par || 'Equipe SUBCO-PRETE',
        type: 'es_risque_declare',
        texte: 'Risque environnemental et social desormais declare : un plan de gestion (PGES) est attendu au dossier.',
      });
    }
  }

  const misAJour = await strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: {
      statut: 'validee',
      montantsStatut: Object.keys(valeursAPorter).length ? 'valide' : demande.montantsStatut,
      validePar: par || null,
      valideParRole: role || null,
      valideLe: maintenant,
      versionProduite,
      piecesFournies: (demande.piecesFournies || []).map((p) => ({ ...p, statut: 'validee' })),
    },
  });

  await journal(strapi, candidature.documentId, {
    auteurLibelle: par || 'Equipe SUBCO-PRETE',
    type: 'demande_maj_validee',
    texte: `Mise a jour validee${role ? ` par ${role}` : ''} — ${libelleObjet(perimetre)}.`,
  });

  // Le message dit CE QUI a ete valide. Trois campagnes peuvent courir sur un meme dossier :
  // « votre mise a jour a ete validee » ne renseigne alors sur rien.
  const piece = (perimetre.pieces || [])[0];
  const corpsValidation = piece
    ? `La piece « ${piece.libelle} » que vous avez fournie sur votre dossier ${candidature.numeroDossier} a ete validee.${
      perimetre.genre === 'piece_revision' ? '\nElle s\'ajoute a la version precedente, qui reste conservee.' : ''}`
    : `Les informations suivantes ont ete validees et portees a votre dossier ${candidature.numeroDossier} :\n`
      + `${changementsValides.map((c) => `  - ${c}`).join('\n') || '  - aucun changement'}`
      + `${versionProduite ? `\n\nVotre dossier passe en version ${versionProduite}.` : ''}`;

  await notifier(strapi, candidature, {
    sujet: `${libelleObjetCourt(perimetre)} — valide (dossier ${candidature.numeroDossier})`,
    corps: corpsValidation,
  });

  return { demande: misAJour, dejaValidee: false };
}

/** Renvoi motive. Porte TOUJOURS une nouvelle echeance : sans elle, l'operateur renvoye
 *  serait hors delai a l'instant meme ou il recoit le renvoi. */
async function renvoyerDemande(strapi, demande, { motif, joursOuvres, echeance, par }) {
  if (!['fournie', 'demandee'].includes(demande.statut)) {
    throw new Error('Cette demande ne peut pas etre renvoyee en l\'etat.');
  }
  if (!motif || !String(motif).trim()) throw new Error('Un motif de renvoi est requis.');

  const nouvelleEcheance = echeance || echeanceOuvree(joursOuvres || 3);
  const candidature = await strapi.documents(UID_CANDIDATURE).findOne({
    documentId: demande.candidature?.documentId || demande.candidature,
    populate: { owner: { fields: ['id', 'email'] } },
  });

  const misAJour = await strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: {
      statut: 'renvoyee',
      motifRenvoi: String(motif).trim(),
      echeance: nouvelleEcheance,
      montantsStatut: (demande.perimetre || {}).montants ? 'renvoye' : demande.montantsStatut,
      relancesEnvoyees: [],
      avisClotureEnvoye: false,
    },
  });

  if (candidature?.documentId) {
    await journal(strapi, candidature.documentId, {
      auteurLibelle: par || 'Equipe SUBCO-PRETE',
      type: 'demande_maj_renvoyee',
      texte: `Mise a jour renvoyee : ${String(motif).trim()} — nouvelle echeance le ${String(nouvelleEcheance).slice(0, 10)}.`,
    });
    await notifier(strapi, candidature, {
      sujet: `${libelleObjetCourt(demande.perimetre)} — correction demandee (dossier ${candidature.numeroDossier})`,
      corps: `Votre reponse concernant ${libelleObjet(demande.perimetre)} appelle une correction :\n\n${String(motif).trim()}\n\nNouvelle echeance : ${dateFr(nouvelleEcheance)}.`,
    });
  }

  return misAJour;
}

/** Reouverture apres echeance. L'etat « maturation non aboutie » n'est pas terminal. */
async function rouvrirDemande(strapi, demande, { joursOuvres, echeance, par }) {
  if (demande.statut !== 'echue') throw new Error('Seule une demande echue se rouvre.');
  const nouvelleEcheance = echeance || echeanceOuvree(joursOuvres || 3);

  const misAJour = await strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: { statut: 'demandee', echeance: nouvelleEcheance, relancesEnvoyees: [], avisClotureEnvoye: false },
  });

  const candidatureId = demande.candidature?.documentId || demande.candidature;
  if (candidatureId) {
    await poserStatut(strapi, candidatureId, 'maturation');
    await journal(strapi, candidatureId, {
      auteurLibelle: par || 'Equipe SUBCO-PRETE',
      type: 'demande_maj_rouverte',
      texte: `Demande rouverte — nouvelle echeance le ${String(nouvelleEcheance).slice(0, 10)}.`,
    });
  }
  return misAJour;
}

// --- Relances et echeances ------------------------------------------------------------

function palierApplicable(heuresRestantes) {
  if (heuresRestantes < 0) return null;
  let choisi = null;
  for (const palier of PALIERS_RELANCE) {
    if (heuresRestantes <= palier.heures) choisi = palier;
  }
  return choisi;
}

/** Paliers couverts quand on envoie `cle` : celui-ci et tous les plus lointains. Sinon un
 *  operateur servi a J-1 recevrait ensuite un « il vous reste trois jours », faux. */
function paliersCouverts(cle) {
  const i = PALIERS_RELANCE.findIndex((p) => p.cle === cle);
  return PALIERS_RELANCE.slice(0, i + 1).map((p) => p.cle);
}

/**
 * Une passe : relances J-3 et J-1, puis basculement des demandes echues.
 *
 * L'echeance porte sur la demande ENTIERE. Si des pieces sont validees mais les montants
 * encore en discussion, le dossier bascule quand meme — sinon valider une piece devient le
 * moyen d'arreter le chronometre indefiniment.
 */
async function passerRelancesEtEcheances(strapi, now = Date.now()) {
  const ouvertes = await strapi.documents(UID_DEMANDE).findMany({
    filters: { statut: { $in: [...STATUTS_OUVERTS, 'fournie'] } },
    populate: { candidature: { populate: { owner: { fields: ['id', 'email'] } } }, type: true },
    limit: 2000,
  });

  let relances = 0;
  let bascules = 0;

  for (const demande of ouvertes) {
    const candidature = demande.candidature;
    if (!candidature?.documentId || !demande.echeance) continue;
    const heuresRestantes = (new Date(demande.echeance).getTime() - now) / 3600000;

    // Une demande deja fournie attend la validation de l'equipe : ni relance ni bascule.
    if (demande.statut === 'fournie') continue;

    if (heuresRestantes < 0) {
      await strapi.documents(UID_DEMANDE).update({
        documentId: demande.documentId,
        data: { statut: 'echue', avisClotureEnvoye: true },
      });
      await poserStatut(strapi, candidature.documentId, 'maturation_non_aboutie');
      await journal(strapi, candidature.documentId, {
        auteurLibelle: 'Plateforme',
        type: 'demande_maj_echue',
        texte: `Echeance du ${String(demande.echeance).slice(0, 10)} atteinte sans reponse complete : dossier en maturation non aboutie.`,
      });
      await notifier(strapi, candidature, {
        sujet: `${libelleObjetCourt(demande.perimetre)} — echeance atteinte (dossier ${candidature.numeroDossier})`,
        corps: `L'echeance de la demande concernant ${libelleObjet(demande.perimetre)}, sur votre dossier ${candidature.numeroDossier}, est passee sans reponse. Votre dossier est signale au Comite de selection en « maturation non aboutie ».\n\nCette situation n'est pas definitive : ecrivez-nous a candidature@subco-prete.bi si vous etes en mesure de fournir les elements demandes.`,
      });
      bascules += 1;
      continue;
    }

    const palier = palierApplicable(heuresRestantes);
    if (!palier) continue;
    const deja = Array.isArray(demande.relancesEnvoyees) ? demande.relancesEnvoyees : [];
    if (deja.includes(palier.cle)) continue;

    await notifier(strapi, candidature, {
      sujet: `${libelleObjetCourt(demande.perimetre)} — rappel, echeance ${palier.libelle} (dossier ${candidature.numeroDossier})`,
      corps: `L'echeance de la demande concernant ${libelleObjet(demande.perimetre)}, sur votre dossier ${candidature.numeroDossier}, tombe ${palier.libelle} (${dateFr(demande.echeance)}). Sans reponse de votre part, votre dossier sera signale au Comite de selection en « maturation non aboutie ».`,
    });
    await strapi.documents(UID_DEMANDE).update({
      documentId: demande.documentId,
      data: { relancesEnvoyees: [...new Set([...deja, ...paliersCouverts(palier.cle)])] },
    });
    relances += 1;
  }

  if (relances || bascules) {
    strapi.log.info(`[maturation] ${relances} relance(s), ${bascules} basculement(s).`);
  }
  return { relances, bascules };
}

module.exports = {
  creerDemandes,
  soumettreDemande,
  validerDemande,
  renvoyerDemande,
  rouvrirDemande,
  passerRelancesEtEcheances,
  echeanceOuvree,
  perimetreDepuisType,
  verifierGenre,
  genreDeduit,
  libelleObjet,
  libelleObjetCourt,
  cleObjet,
  GENRES,
  PALIERS_RELANCE,
};
