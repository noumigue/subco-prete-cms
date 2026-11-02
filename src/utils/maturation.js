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
// LE PERIMETRE EST FIGE A LA CREATION. On recopie dans la demande ce que le type autorise,
// au lieu de relire le type a chaque soumission : un referentiel modifie en cours de route
// ne doit pas elargir retroactivement ce qu'un operateur peut changer sur un dossier dont
// la note est figee depuis le 5 octobre et validee par le Comite le 20.

const { buildCandidaturePdf } = require('./portal-pdf');
const { journal } = require('./portal-instruction');
const { sendPortalNotification } = require('./portal-notify');
const { uploadPdfBuffer } = require('./portal-pdf-upload');

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

// --- Outils -------------------------------------------------------------------------

function nombreOuNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

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
  const pieces = (type?.piecesAttendues || []).map((p) => ({
    libelle: p.libelle,
    groupe: p.groupe || null,
    exigence: p.exigence || 'obligatoire',
  }));
  return {
    pieces,
    montants: Boolean(type?.montantsOuverts),
    champs: Array.isArray(type?.champsOuverts) ? type.champsOuverts : [],
    validationRequise: type?.validationRequise !== false,
  };
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
async function creerDemandes(strapi, { typeDocumentId, candidatureDocumentIds, campagne, echeance, joursOuvres, demandeePar }) {
  const type = await strapi.documents(UID_TYPE).findOne({
    documentId: typeDocumentId,
    populate: { piecesAttendues: true },
  });
  if (!type?.documentId) throw new Error(`Type de demande introuvable : ${typeDocumentId}`);
  if (type.actif === false) throw new Error(`Le type « ${type.libelle} » est desactive.`);

  const perimetre = perimetreDepuisType(type);
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

      // La seconde interdit deux demandes OUVERTES sur un meme dossier, toutes campagnes
      // confondues : l'operateur ne saurait pas a laquelle il repond, et l'echeance de
      // l'une ferait basculer son dossier pendant qu'il traite l'autre.
      const enCours = await strapi.documents(UID_DEMANDE).findFirst({
        filters: { candidature: { documentId }, statut: { $in: [...STATUTS_OUVERTS, 'fournie'] } },
      });
      if (enCours?.documentId) {
        erreurs.push({
          documentId,
          numero: candidature.numeroDossier,
          motif: `une demande est deja en cours (${enCours.statut}) sur ce dossier`,
        });
        continue;
      }

      const demande = await strapi.documents(UID_DEMANDE).create({
        data: {
          candidature: { connect: [documentId] },
          type: { connect: [type.documentId] },
          campagne: campagne || null,
          phase: type.phase || 'maturation',
          perimetre,
          texteDemande: type.texteDemande || null,
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
        texte: `Demande de mise a jour « ${type.libelle} » — echeance le ${String(echeanceFinale).slice(0, 10)}.`,
      });

      await notifier(strapi, candidature, {
        sujet: `Mise a jour demandee sur votre dossier ${candidature.numeroDossier}`,
        corps: `${type.texteDemande || `Une mise a jour vous est demandee sur votre dossier ${candidature.numeroDossier}.`}\n\nVous avez jusqu'au ${String(echeanceFinale).slice(0, 10)} pour y repondre depuis votre espace operateur.`,
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
async function soumettreDemande(strapi, demande, { pieces, montants }) {
  if (!STATUTS_OUVERTS.includes(demande.statut)) {
    throw new Error('Cette demande n\'est plus ouverte.');
  }
  const perimetre = demande.perimetre || {};

  // Garde de perimetre : une piece hors de ce qui a ete demande est refusee, pas ignoree.
  const attendues = new Set((perimetre.pieces || []).map((p) => p.libelle));
  const fournies = (Array.isArray(pieces) ? pieces : []).filter((p) => p && p.libelle);
  const intruse = fournies.find((p) => !attendues.has(p.libelle));
  if (intruse) throw new Error(`La piece « ${intruse.libelle} » ne fait pas partie de la demande.`);

  let montantsProposes = demande.montantsProposes || null;
  let montantsStatut = demande.montantsStatut;
  if (perimetre.montants && montants) {
    const budgetTotal = nombreOuNull(montants.budgetTotal);
    const contrepartie = nombreOuNull(montants.contrepartie);
    if (budgetTotal === null || contrepartie === null) {
      throw new Error('Le budget total et la contrepartie sont tous deux requis.');
    }
    if (contrepartie > budgetTotal) {
      throw new Error('La contrepartie ne peut pas depasser le budget total.');
    }
    montantsProposes = {
      budgetTotal,
      contrepartie,
      typeContrepartie: montants.typeContrepartie || null,
      commentaire: montants.commentaire || null,
    };
    montantsStatut = 'propose';
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

  return strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: {
      statut: 'fournie',
      soumisLe: new Date().toISOString(),
      piecesFournies: [...pieceDeja.values()],
      montantsProposes,
      montantsStatut,
      motifRenvoi: null,
    },
  });
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

  if (perimetre.montants && demande.montantsProposes) {
    const ancien = candidature.donneesProjet || {};
    const ancienFin = ancien.financement || {};
    const nouveau = {
      ...ancien,
      financement: {
        ...ancienFin,
        budgetTotal: demande.montantsProposes.budgetTotal,
        contrepartie: demande.montantsProposes.contrepartie,
        ...(demande.montantsProposes.typeContrepartie
          ? { typeContrepartie: demande.montantsProposes.typeContrepartie }
          : {}),
      },
    };

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
        montantsMatures: true,
        montantsMaturesLe: maintenant,
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
      type: 'montants_matures',
      texte: `Montants matures et valides : budget ${ancienFin.budgetTotal ?? '—'} -> ${nouveau.financement.budgetTotal}, contrepartie ${ancienFin.contrepartie ?? '—'} -> ${nouveau.financement.contrepartie} (version ${versionSuivante}).`,
    });
  }

  const misAJour = await strapi.documents(UID_DEMANDE).update({
    documentId: demande.documentId,
    data: {
      statut: 'validee',
      montantsStatut: perimetre.montants ? 'valide' : demande.montantsStatut,
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
    texte: `Mise a jour validee${role ? ` par ${role}` : ''}.`,
  });

  await notifier(strapi, candidature, {
    sujet: `Mise a jour validee — dossier ${candidature.numeroDossier}`,
    corps: `La mise a jour de votre dossier ${candidature.numeroDossier} a ete validee.${versionProduite ? ` Les montants de votre projet ont ete actualises (version ${versionProduite}).` : ''}`,
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
      sujet: `Complement attendu — dossier ${candidature.numeroDossier}`,
      corps: `Votre mise a jour appelle une correction :\n\n${String(motif).trim()}\n\nNouvelle echeance : ${String(nouvelleEcheance).slice(0, 10)}.`,
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
        sujet: `Echeance atteinte — dossier ${candidature.numeroDossier}`,
        corps: `L'echeance de la mise a jour demandee sur votre dossier ${candidature.numeroDossier} est passee sans reponse complete. Votre dossier est signale au Comite de selection en « maturation non aboutie ».\n\nCette situation n'est pas definitive : ecrivez-nous a candidature@subco-prete.bi si vous etes en mesure de fournir les elements demandes.`,
      });
      bascules += 1;
      continue;
    }

    const palier = palierApplicable(heuresRestantes);
    if (!palier) continue;
    const deja = Array.isArray(demande.relancesEnvoyees) ? demande.relancesEnvoyees : [];
    if (deja.includes(palier.cle)) continue;

    await notifier(strapi, candidature, {
      sujet: `Rappel — mise a jour attendue sur votre dossier ${candidature.numeroDossier}`,
      corps: `L'echeance de la mise a jour demandee sur votre dossier ${candidature.numeroDossier} tombe ${palier.libelle}. Sans reponse de votre part, votre dossier sera signale au Comite de selection en « maturation non aboutie ».`,
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
  PALIERS_RELANCE,
};
