'use strict';

const CANONICAL_STATUS_ORDER = [
  { code: 'brouillon', libelleCandidat: 'Brouillon', groupe: 'brouillon', phase: 'recu', ordre: 10 },
  { code: 'soumis', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'recu', ordre: 20 },
  { code: 'recu', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'recu', ordre: 30 },
  { code: 'completude', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'completude', ordre: 40 },
  { code: 'eligibilite', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'eligibilite', ordre: 50 },
  { code: 'evaluation', libelleCandidat: 'En instruction', groupe: 'en_instruction', phase: 'evaluation', ordre: 60 },
  { code: 'selectionne', libelleCandidat: 'Selectionne', groupe: 'selectionne', phase: 'decision', ordre: 70 },
  { code: 'non_retenu', libelleCandidat: 'Non retenu', groupe: 'non_retenu', phase: 'decision', ordre: 80 },
];

const ACTIVE_STATUS_CODES = ['brouillon', 'soumis', 'recu', 'completude', 'eligibilite', 'evaluation'];

function isActiveStatus(code) {
  return ACTIVE_STATUS_CODES.includes(code);
}

module.exports = {
  ACTIVE_STATUS_CODES,
  CANONICAL_STATUS_ORDER,
  isActiveStatus,
};
