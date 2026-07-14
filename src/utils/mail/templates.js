'use strict';

// Registre de templates « code » — SOURCE DE VERITE et fallback sur de la mail platform.
//
// Chaque template a une CLE STABLE (ex. `auth.account_confirmation`) referencee par le code
// metier. Un template edite au CMS (content-type `mail-template`, publie) peut SURCHARGER
// ce defaut a la meme cle ; s'il est absent, incomplet ou invalide, on retombe ici.
//
// Un template = { subject, text, html, requiredVars, description, category }.
//  - subject / text / html : chaines au format renderer ({{var}}, {{#if}}...).
//  - requiredVars : variables que le payload DOIT fournir (validees avant envoi).
//  - `html` est optionnel : s'il manque, mail-service enrobe `text` dans le layout par defaut.
//
// Variables communes injectees par mail-service pour TOUS les templates :
//   portalUrl, cmsUrl, year, brandName  (cf. mail-service.buildBaseContext)

const BRAND_NAME = 'SUBCO PRETE';

// Layout HTML commun (in-line styles : les clients mail ignorent <style>/classes).
// `{{{ body }}}` est injecte en BRUT (contenu de confiance produit par nos templates).
function layout(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f6f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
          <tr><td style="background:#0fa37f;padding:20px 28px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px;">${BRAND_NAME}</span>
          </td></tr>
          <tr><td style="padding:28px;line-height:1.6;font-size:15px;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:18px 28px;background:#f4f6f5;color:#6b7280;font-size:12px;line-height:1.5;">
            Message automatique — Subventions de contrepartie PRETE.<br/>
            Merci de ne pas repondre directement a cet e-mail.
          </td></tr>
        </table>
        <div style="color:#9ca3af;font-size:11px;font-family:Arial,sans-serif;margin-top:12px;">© {{ year }} ${BRAND_NAME}</div>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Bouton d'action reutilisable.
function button(label, url) {
  return `<p style="margin:24px 0;">
    <a href="${url}" style="display:inline-block;padding:12px 22px;background:#0fa37f;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;">${label}</a>
  </p>
  <p style="font-size:13px;color:#6b7280;">Si le bouton ne fonctionne pas, copiez ce lien :<br/><span style="color:#0fa37f;word-break:break-all;">${url}</span></p>`;
}

const TEMPLATES = {
  // === AUTHENTIFICATION (sortie des e-mails natifs Strapi) ===========================
  'auth.account_confirmation': {
    category: 'auth',
    description: "Confirmation d'adresse a l'inscription operateur.",
    requiredVars: ['confirmationUrl'],
    subject: `${BRAND_NAME} — Confirmez votre adresse e-mail`,
    text: [
      'Bonjour{{#if orgName}} {{orgName}}{{/if}},',
      '',
      'Bienvenue sur la plateforme des subventions de contrepartie PRETE.',
      'Pour activer votre compte, confirmez votre adresse en ouvrant ce lien :',
      '{{confirmationUrl}}',
      '',
      "Si vous n'etes pas a l'origine de cette inscription, ignorez ce message.",
    ].join('\n'),
    html: layout(`
      <p>Bonjour{{#if orgName}} <strong>{{orgName}}</strong>{{/if}},</p>
      <p>Bienvenue sur la plateforme des subventions de contrepartie PRETE. Pour activer votre compte, confirmez votre adresse e-mail.</p>
      ${button('Confirmer mon adresse', '{{{confirmationUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Si vous n'etes pas a l'origine de cette inscription, ignorez ce message.</p>
    `),
  },

  'auth.password_reset': {
    category: 'auth',
    description: 'Lien de reinitialisation du mot de passe operateur.',
    requiredVars: ['resetUrl'],
    subject: `${BRAND_NAME} — Reinitialisation de votre mot de passe`,
    text: [
      'Bonjour,',
      '',
      'Vous avez demande la reinitialisation de votre mot de passe.',
      'Ouvrez ce lien pour definir un nouveau mot de passe :',
      '{{resetUrl}}',
      '',
      "Ce lien expire prochainement. Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre mot de passe reste inchange.",
    ].join('\n'),
    html: layout(`
      <p>Bonjour,</p>
      <p>Vous avez demande la reinitialisation de votre mot de passe.</p>
      ${button('Definir un nouveau mot de passe', '{{{resetUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Ce lien expire prochainement. Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre mot de passe reste inchange.</p>
    `),
  },

  'auth.email_change_confirmation': {
    category: 'auth',
    description: "Confirmation de la NOUVELLE adresse lors d'un changement d'e-mail (D2).",
    requiredVars: ['confirmationUrl'],
    subject: `${BRAND_NAME} — Confirmez votre nouvelle adresse e-mail`,
    text: [
      'Bonjour,',
      '',
      'Pour activer cette adresse comme identifiant de connexion, ouvrez ce lien :',
      '{{confirmationUrl}}',
      '',
      "Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre adresse actuelle reste inchangee.",
    ].join('\n'),
    html: layout(`
      <p>Bonjour,</p>
      <p>Pour activer cette adresse comme identifiant de connexion, confirmez-la.</p>
      ${button('Confirmer la nouvelle adresse', '{{{confirmationUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre adresse actuelle reste inchangee.</p>
    `),
  },

  'auth.account_invitation': {
    category: 'auth',
    description: "Invitation d'un compte interne (Espace de gestion) — definition du mot de passe.",
    requiredVars: ['invitationUrl'],
    subject: `${BRAND_NAME} — Activez votre compte, Espace de gestion`,
    text: [
      'Bonjour {{nom}},',
      '',
      "Un compte vous a ete cree sur l'Espace de gestion SUBCO-PRETE.",
      'Pour l\'activer, definissez votre mot de passe via ce lien :',
      '{{invitationUrl}}',
      '',
      "Ce lien est personnel. Si vous n'attendiez pas cette invitation, ignorez ce message.",
      '',
      '— UGP PRETE',
    ].join('\n'),
    html: layout(`
      <p>Bonjour <strong>{{nom}}</strong>,</p>
      <p>Un compte vous a ete cree sur l'Espace de gestion SUBCO-PRETE. Pour l'activer, definissez votre mot de passe.</p>
      ${button('Definir mon mot de passe', '{{{invitationUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Ce lien est personnel. Si vous n'attendiez pas cette invitation, ignorez ce message.</p>
      <p style="font-size:13px;color:#6b7280;">— UGP PRETE</p>
    `),
  },

  // === APPEL A MANIFESTATION D'INTERET (AMI) =========================================
  'ami.open_notification': {
    category: 'ami',
    description: "Alerte d'ouverture d'un appel a propositions aux inscrits AMI.",
    requiredVars: ['callUrl', 'unsubscribeUrl'],
    subject: `${BRAND_NAME} — {{#if callTitle}}{{callTitle}}{{else}}L'appel a propositions est ouvert{{/if}}`,
    text: [
      'Bonjour,',
      '',
      '{{intro}}',
      '{{#if dateBits}}{{dateBits}}{{/if}}',
      '',
      "Voir le detail de l'appel : {{callUrl}}",
      '',
      'Se desinscrire : {{unsubscribeUrl}}',
    ].join('\n'),
    html: layout(`
      <p>Bonjour,</p>
      <p>{{intro}}</p>
      {{#if dateBits}}<p><strong>{{dateBits}}</strong></p>{{/if}}
      ${button("Voir le detail de l'appel", '{{{callUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Si vous ne souhaitez plus recevoir ces alertes, <a href="{{{unsubscribeUrl}}}" style="color:#0fa37f;">desinscrivez-vous</a>.</p>
    `),
  },

  // === CANDIDATURE ====================================================================
  'candidate.submission_received': {
    category: 'candidate',
    description: "Accuse de reception d'une candidature soumise.",
    requiredVars: ['sujet', 'corps'],
    subject: `[${BRAND_NAME}] {{sujet}}`,
    text: '{{corps}}',
    html: layout(`
      <p style="white-space:pre-line;">{{corps}}</p>
      {{#if candidatureUrl}}${button('Voir ma candidature', '{{{candidatureUrl}}}')}{{/if}}
    `),
  },

  'candidate.status_updated': {
    category: 'candidate',
    description: "Notification de changement de statut d'un dossier.",
    requiredVars: ['sujet', 'corps'],
    subject: `[${BRAND_NAME}] {{sujet}}`,
    text: '{{corps}}',
    html: layout(`
      <p style="white-space:pre-line;">{{corps}}</p>
      {{#if candidatureUrl}}${button('Voir mon dossier', '{{{candidatureUrl}}}')}{{/if}}
    `),
  },

  // === ASSISTANCE =====================================================================
  'assistance.response_posted': {
    category: 'assistance',
    description: "Notification d'une reponse de l'equipe sur un fil d'assistance.",
    requiredVars: ['sujet', 'corps'],
    subject: `[${BRAND_NAME}] {{sujet}}`,
    text: '{{corps}}',
    html: layout(`
      <p style="white-space:pre-line;">{{corps}}</p>
      {{#if assistanceUrl}}${button('Ouvrir le fil', '{{{assistanceUrl}}}')}{{/if}}
    `),
  },

  // === SUBVENTION =====================================================================
  'subvention.signed': {
    category: 'subvention',
    description: 'Notification de signature / activation de la subvention.',
    requiredVars: ['sujet', 'corps'],
    subject: `[${BRAND_NAME}] {{sujet}}`,
    text: '{{corps}}',
    html: layout(`
      <p style="white-space:pre-line;">{{corps}}</p>
      {{#if subventionUrl}}${button('Voir ma subvention', '{{{subventionUrl}}}')}{{/if}}
    `),
  },

  // === GENERIQUE ======================================================================
  // Fallback pour les notifications portail a sujet/corps libres (portal-notify) : garantit
  // journalisation + layout coherent sans exiger une cle dediee par evenement.
  'notification.generic': {
    category: 'notification',
    description: 'Notification portail generique (sujet + corps libres).',
    requiredVars: ['sujet', 'corps'],
    subject: `[${BRAND_NAME}] {{sujet}}`,
    text: '{{corps}}',
    html: layout(`<p style="white-space:pre-line;">{{corps}}</p>`),
  },
};

function getCodeTemplate(key) {
  return TEMPLATES[key] || null;
}

function listTemplateKeys() {
  return Object.keys(TEMPLATES);
}

module.exports = { TEMPLATES, getCodeTemplate, listTemplateKeys, layout, BRAND_NAME };
