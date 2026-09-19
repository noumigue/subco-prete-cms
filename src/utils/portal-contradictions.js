'use strict';

// Contradictions entre le VERDICT propose par l'instructeur et ses propres CONSTATS.
//
// Elles ne bloquent rien : l'instructeur reste libre de son jugement et doit de toute facon
// motiver sa proposition (observations obligatoires). Elles servent a signaler le dossier
// a l'UGP comme « a arbitrer », independamment de ce que dit l'observation — un « RAS » ne
// doit pas pouvoir masquer un dossier declare complet avec une piece obligatoire absente.
//
// Fonctions PURES (aucun acces base) : elles sont appelees a la fois par la file, le detail
// du dossier et la verification « a blanc » avant envoi, pour qu'une seule regle fasse foi.

const FAUTIVES = ['absente', 'non_conforme'];
const ETAT_LIBELLE = { absente: 'absente', non_conforme: 'non conforme' };

// Pieces obligatoires AU MOMENT DU DEPOT. Le referentiel a evolue pendant l'appel (trois pieces
// devenues obligatoires le 02/09) : un dossier depose avant ne doit pas etre juge sur elles
// tant que l'UGP n'a pas decide de les exiger.
function piecesObligatoiresApplicables(typePieces, dateDepot) {
  const depot = dateDepot ? new Date(dateDepot).getTime() : null;
  return (typePieces || []).filter((p) => {
    if (p.exigence !== 'obligatoire') return false;
    if (depot === null || !p.createdAt) return true;
    return new Date(p.createdAt).getTime() <= depot;
  });
}

// Une piece est « deposee » si le dossier porte un fichier pour ce type de piece (meme
// croisement que l'ecran d'instruction), ou si le candidat l'a fournie ensuite en complement.
function aUnFichier(piece, donneesProjet, complementsFournis) {
  const deposees = Array.isArray(donneesProjet?.pieces) ? donneesProjet.pieces : [];
  if (deposees.some((d) => d && d.id === piece.documentId && d.depose && d.fileId)) return true;
  const libelle = String(piece.libelle || '').trim().toLowerCase();
  return (complementsFournis || []).some(
    (c) => c && c.statut === 'fourni' && String(c.pieceDemandee || '').trim().toLowerCase() === libelle,
  );
}

// instruction : { verdictGlobal, verdictsPieces, complementsProposes }
// candidature : { dateDepot, donneesProjet }
// `dejaDemandees` : libelles des pieces deja reclamees au candidat et encore attendues. Une piece
// fautive qui en fait partie n'a pas a figurer dans la nouvelle demande (elle est deja en cours).
function detecterContradictionsCompletude({ instruction, candidature, typePieces, complementsFournis, dejaDemandees = [] }) {
  const verdict = instruction?.verdictGlobal;
  if (!verdict) return [];
  const constats = instruction.verdictsPieces && typeof instruction.verdictsPieces === 'object' ? instruction.verdictsPieces : {};
  const demandees = new Set(Array.isArray(instruction.complementsProposes?.pieces) ? instruction.complementsProposes.pieces : []);
  const obligatoires = piecesObligatoiresApplicables(typePieces, candidature?.dateDepot);
  const out = [];
  const etat = (p) => constats[p.documentId]?.etat;
  const enCours = new Set((dejaDemandees || []).map((l) => String(l || '').trim().toLowerCase()));
  const dejaEnCours = (p) => enCours.has(String(p.libelle || '').trim().toLowerCase());

  for (const p of obligatoires) {
    const e = etat(p);
    if (verdict === 'complet' && FAUTIVES.includes(e)) {
      out.push({ code: 'C1', message: `Déclaré complet alors que « ${p.libelle} » est marquée ${ETAT_LIBELLE[e]}.` });
    }
    if (verdict === 'complements' && FAUTIVES.includes(e) && !demandees.has(p.documentId) && !dejaEnCours(p)) {
      out.push({ code: 'C2', message: `« ${p.libelle} » est marquée ${ETAT_LIBELLE[e]} mais n'est pas demandée au candidat.` });
    }
    if (e === 'presente' && !aUnFichier(p, candidature?.donneesProjet, complementsFournis)) {
      out.push({ code: 'C3', message: `« ${p.libelle} » est marquée présente alors qu'aucun fichier n'a été déposé pour cette pièce.` });
    }
    if ((verdict === 'complet' || verdict === 'complements') && !e) {
      out.push({ code: 'C5', message: `« ${p.libelle} » n'a pas été examinée.` });
    }
  }

  if (verdict === 'rejet' && obligatoires.length > 0 && obligatoires.every((p) => etat(p) === 'presente')) {
    out.push({ code: 'C4', message: 'Rejet proposé alors que toutes les pièces obligatoires sont présentes et conformes.' });
  }
  return out;
}

// instruction : { verdictGlobal, verdictsCriteres }
function detecterContradictionsEligibilite({ instruction, criteres }) {
  const verdict = instruction?.verdictGlobal;
  if (!verdict) return [];
  const constats = instruction.verdictsCriteres && typeof instruction.verdictsCriteres === 'object' ? instruction.verdictsCriteres : {};
  const liste = criteres || [];
  const out = [];

  if (verdict === 'eligible') {
    for (const c of liste) {
      if (constats[c.documentId]?.etat === 'non_conforme') {
        out.push({ code: 'E1', message: `Déclaré éligible alors que le critère « ${c.libelle} » est marqué non conforme.` });
      }
    }
  }
  if (verdict === 'rejet' && liste.length > 0 && liste.every((c) => constats[c.documentId]?.etat === 'conforme')) {
    out.push({ code: 'E2', message: 'Rejet proposé alors que tous les critères sont marqués conformes.' });
  }
  return out;
}

module.exports = {
  piecesObligatoiresApplicables,
  detecterContradictionsCompletude,
  detecterContradictionsEligibilite,
};
