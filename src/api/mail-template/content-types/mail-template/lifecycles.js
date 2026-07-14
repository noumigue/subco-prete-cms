'use strict';

// Garde-fous des templates editables au CMS (exigence « garde-fou »).
// Avant creation/mise a jour, on VALIDE :
//  1. la cle appartient au registre code connu (pas de cle fantome sans usage) ;
//  2. le sujet + le corps texte se parsent sans variable inconnue par rapport aux
//     placeholders autorises pour cette cle (requiredVars + variables communes + optionnelles).
// Un template invalide est REJETE a l'edition => on ne peut pas publier un template casse.
// A l'execution, mail-service ajoute une 2e ceinture : tout echec de rendu retombe sur le defaut code.

const { getCodeTemplate } = require('../../../../utils/mail/templates');
const { extractVariables } = require('../../../../utils/mail/renderer');

// Variables toujours disponibles (injectees par mail-service.buildBaseContext) + variables
// « optionnelles » usuelles des templates code, tolerees dans les surcharges.
const COMMON_VARS = new Set([
  'portalUrl', 'cmsUrl', 'year', 'brandName',
  'orgName', 'nom', 'sujet', 'corps',
  'callTitle', 'intro', 'dateBits',
  'candidatureUrl', 'assistanceUrl', 'subventionUrl',
]);

function allowedVarsForKey(cle) {
  const code = getCodeTemplate(cle);
  const allowed = new Set(COMMON_VARS);
  if (code?.requiredVars) code.requiredVars.forEach((v) => allowed.add(v));
  // Les placeholders connus du defaut code sont aussi tolerables.
  if (code) {
    extractVariables(`${code.subject || ''} ${code.text || ''} ${code.html || ''}`).forEach((v) => allowed.add(v));
  }
  return allowed;
}

function validate(data, previous = {}) {
  const cle = (data.cle ?? previous.cle ?? '').trim();
  if (!cle) return; // le champ required de Strapi s'en charge

  const code = getCodeTemplate(cle);
  if (!code) {
    throw new Error(
      `Cle de template inconnue « ${cle} ». Utilisez une cle du registre code (src/utils/mail/templates.js) — sinon la surcharge ne sera jamais consommee.`
    );
  }

  const allowed = allowedVarsForKey(cle);
  const subject = data.sujet ?? previous.sujet ?? '';
  const text = data.corpsTexte ?? previous.corpsTexte ?? '';
  const html = data.corpsHtml ?? previous.corpsHtml ?? '';

  const used = extractVariables(`${subject}\n${text}\n${html}`);
  const unknown = used.filter((v) => !allowed.has(v));
  if (unknown.length) {
    throw new Error(
      `Variable(s) inconnue(s) dans le template « ${cle} » : ${unknown.join(', ')}. ` +
      `Variables autorisees : ${[...allowed].sort().join(', ')}.`
    );
  }

  // Trace informative des placeholders reellement requis par le defaut code.
  data.placeholdersConnus = { requiredVars: code.requiredVars || [], allowed: [...allowed].sort() };
}

module.exports = {
  async beforeCreate(event) {
    validate(event.params.data);
  },
  async beforeUpdate(event) {
    // On recharge l'existant pour valider sur l'etat fusionne (edition partielle).
    let previous = {};
    const id = event.params.where?.id;
    if (id) {
      previous = (await strapi.db.query('api::mail-template.mail-template').findOne({ where: { id } })) || {};
    }
    validate(event.params.data, previous);
  },
};
