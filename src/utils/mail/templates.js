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
            {{ noteReponse }}
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
    subject: `${BRAND_NAME} — {{#if callTitle}}{{callTitle}} : les candidatures sont ouvertes{{else}}Les candidatures sont ouvertes{{/if}}`,
    text: [
      'Bonjour,',
      '',
      '{{intro}}',
      '{{#if dateBits}}{{dateBits}}{{/if}}',
      '',
      'Pour déposer un dossier, vous devez créer un compte sur la plateforme.',
      'La page ci-dessous indique les pièces à préparer et mène au formulaire.',
      '',
      'Préparer et déposer ma candidature : {{callUrl}}',
      '',
      'Se désinscrire : {{unsubscribeUrl}}',
    ].join('\n'),
    html: layout(`
      <p>Bonjour,</p>
      <p>{{intro}}</p>
      {{#if dateBits}}<p><strong>{{dateBits}}</strong></p>{{/if}}
      <p>Pour déposer un dossier, vous devez créer un compte sur la plateforme. La page ci-dessous indique les pièces à préparer et mène au formulaire.</p>
      ${button('Préparer et déposer ma candidature', '{{{callUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Si vous ne souhaitez plus recevoir ces alertes, <a href="{{{unsubscribeUrl}}}" style="color:#0fa37f;">désinscrivez-vous</a>.</p>
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

  // === CAMPAGNES (envois groupes) =====================================================
  // Famille `campagne.*` : messages adresses a une POPULATION (relance, information),
  // et non a un evenement du dossier. Deux differences avec les autres familles :
  //  - la liste des pieces est PRE-RENDUE par l'appelant (`piecesTexte` / `piecesHtml`) :
  //    le renderer ne sait pas boucler ({{#each}} n'existe pas), et c'est voulu — le tri
  //    et le groupement par exigence relevent de la campagne, pas du template ;
  //  - `piecesHtml` est injecte en BRUT ({{{ }}}) : contenu produit par notre script a
  //    partir du referentiel `type-piece`, jamais par un candidat.
  'campagne.relance_pieces': {
    category: 'campagne',
    description: "Relance d'un candidat arrete a l'etape 4, avec SES pieces manquantes.",
    requiredVars: ['piecesTexte', 'piecesHtml', 'dateCloture', 'dossierUrl', 'nbManquantesTexte'],
    subject: `${BRAND_NAME} — Il vous reste {{nbManquantesTexte}} à joindre avant le {{dateCloture}}`,
    text: [
      'Bonjour{{#if orgName}} {{orgName}}{{/if}},',
      '',
      "Vous avez engagé votre candidature à l'appel à propositions PRETE — Cohorte 1 : votre projet",
      "est décrit et l'essentiel du formulaire est derrière vous. C'est la partie la plus longue, et",
      "vous l'avez faite. Nous serions heureux de pouvoir examiner votre dossier et, s'il est retenu",
      "par le comité, de compter votre organisation parmi les opérateurs financés par SUBCO-PRETE.",
      '',
      "Votre dossier n'a pas encore été soumis, et l'appel ferme le {{dateCloture}}.",
      '',
      '{{#if nbDeposeesTexte}}Vous avez déjà déposé {{nbDeposeesTexte}}. {{/if}}Il vous reste à joindre :',
      '',
      '{{piecesTexte}}',
      '',
      'Ce que signifient ces mentions :',
      '  Obligatoire   — exigée pour que votre dossier soit complet.',
      '  Si applicable — seulement si votre projet est concerné.',
      '  Si disponible — à joindre si vous en disposez.',
      '',
      "Où les déposer : ouvrez votre dossier, étape 4 « Pièces du dossier ».",
      '{{dossierUrl}}',
      'Un fichier par pièce, en PDF ou en image, 10 Mo maximum par fichier.',
      '',
      "IMPORTANT — déposer les pièces ne suffit pas. Votre dossier n'est enregistré qu'après",
      "avoir cliqué sur « Soumettre le dossier » à la fin de l'étape 4. Tant que ce bouton n'a",
      "pas été actionné, votre candidature n'est pas déposée et ne pourra pas être instruite.",

      '',
      "UNE QUESTION SUR UNE PIÈCE — où l'obtenir, quelles alternatives sont acceptées, ce que recouvre",
      "exactement telle ou telle exigence ? Sollicitez-nous autant que nécessaire :",
      '',
      '  - par e-mail : candidature@subco-prete.bi',
      "  - depuis l'espace opérateur, rubrique Assistance (votre demande est suivie et tracée)",
      '  - sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit',
      '',
      "Vous n'êtes pas encore sur les groupes WhatsApp ? Demandez votre inscription à",
      'Mme Euphrasie BIGIRIMANA, +257 79 22 23 00.',
      '',
      'La liste complète des pièces du dossier est rappelée sur {{portalUrl}}/candidature.',
      '',
      "{{#if joursTexte}}Il vous reste {{joursTexte}} : vous êtes à quelques documents du dépôt, ce serait dommage d'en rester là.{{/if}}",
      '',
      "L'équipe SUBCO-PRETE",
    ].join('\n'),
    html: layout(`
      <p>Bonjour{{#if orgName}} <strong>{{orgName}}</strong>{{/if}},</p>
      <p>Vous avez engagé votre candidature à l'appel à propositions <strong>PRETE — Cohorte 1</strong> :
         votre projet est décrit et l'essentiel du formulaire est derrière vous. C'est la partie la plus
         longue, et vous l'avez faite. Nous serions heureux de pouvoir examiner votre dossier et, s'il est
         retenu par le comité, de <strong>compter votre organisation parmi les opérateurs financés
         par SUBCO-PRETE</strong>.</p>
      <p>Votre dossier n'a pas encore été soumis, et l'appel ferme le <strong>{{dateCloture}}</strong>.</p>
      <p>{{#if nbDeposeesTexte}}Vous avez déjà déposé <strong>{{nbDeposeesTexte}}</strong>. {{/if}}Il vous reste à joindre :</p>
      {{{piecesHtml}}}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;font-size:13px;color:#4b5563;">
        <tr><td style="padding:2px 10px 2px 0;white-space:nowrap;"><strong>Obligatoire</strong></td><td style="padding:2px 0;">exigée pour que votre dossier soit complet.</td></tr>
        <tr><td style="padding:2px 10px 2px 0;white-space:nowrap;"><strong>Si applicable</strong></td><td style="padding:2px 0;">seulement si votre projet est concerné.</td></tr>
        <tr><td style="padding:2px 10px 2px 0;white-space:nowrap;"><strong>Si disponible</strong></td><td style="padding:2px 0;">à joindre si vous en disposez.</td></tr>
      </table>
      <p>Elles se déposent dans votre dossier, à l'<strong>étape 4 « Pièces du dossier »</strong> —
         un fichier par pièce, en PDF ou en image, 10 Mo maximum par fichier.</p>
      ${button('Ouvrir mon dossier', '{{{dossierUrl}}}')}
      <p style="margin:22px 0;padding:14px 16px;background:#fdf6e7;border-left:4px solid #d99a2b;border-radius:6px;">
        <strong>Déposer les pièces ne suffit pas.</strong> Votre dossier n'est enregistré qu'après avoir cliqué
        sur « <strong>Soumettre le dossier</strong> » à la fin de l'étape 4. Tant que ce bouton n'a pas été
        actionné, votre candidature n'est pas déposée et ne pourra pas être instruite.
      </p>
      <div style="margin:24px 0 0;padding:16px 18px;background:#eef7f4;border-radius:10px;">
        <p style="margin:0 0 10px;"><strong>Une question sur une pièce ?</strong> Où l'obtenir, quelles
           alternatives sont acceptées, ce que recouvre exactement telle exigence — sollicitez-nous autant
           que nécessaire :</p>
        <ul style="margin:0 0 10px;padding-left:20px;line-height:1.8;">
          <li>Par e-mail : <a href="mailto:candidature@subco-prete.bi" style="color:#0fa37f;">candidature@subco-prete.bi</a></li>
          <li>Depuis l'espace opérateur, rubrique <em>Assistance</em> — votre demande y est suivie et tracée</li>
          <li>Sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit</li>
        </ul>
        <p style="margin:0;font-size:13px;color:#4b5563;">Pas encore sur les groupes WhatsApp ? Demandez votre
           inscription à <strong>Mme Euphrasie BIGIRIMANA</strong>, <a href="tel:+25779222300" style="color:#0fa37f;">+257 79 22 23 00</a>.</p>
      </div>
      {{#if joursTexte}}<p style="margin:22px 0 0;font-size:15px;">Il vous reste <strong>{{joursTexte}}</strong> :
         vous êtes à quelques documents du dépôt, ce serait dommage d'en rester là.</p>{{/if}}
      <p style="font-size:13px;color:#6b7280;">La liste complète des pièces du dossier est rappelée sur
         <a href="{{portalUrl}}/candidature" style="color:#0fa37f;">{{portalUrl}}/candidature</a>.</p>
    `),
  },

  // Population 2 du bilan : compte cree ET confirme, aucun dossier ouvert. Deux actes
  // deliberes puis plus rien — le blocage n'est donc pas la motivation mais, tres
  // probablement, la liste des pieces entrevue a l'ouverture du formulaire. D'ou le parti
  // pris : montrer la liste COMPLETE (groupee par nature, pour suivre le parcours reel de
  // collecte) tout en disant qu'on peut commencer sans l'avoir reunie.
  'campagne.dossier_non_ouvert': {
    category: 'campagne',
    description: 'Relance d\'un operateur inscrit et confirme qui n\'a jamais ouvert de dossier.',
    requiredVars: ['piecesTexte', 'piecesHtml', 'dateCloture', 'dossierUrl'],
    subject: `${BRAND_NAME} — Votre compte est prêt, votre dossier reste à ouvrir`,
    text: [
      'Bonjour{{#if orgName}} {{orgName}}{{/if}},',
      '',
      "Vous avez créé votre compte sur la plateforme des subventions de contrepartie PRETE et",
      "confirmé votre adresse : tout est prêt de votre côté. Il vous reste à ouvrir votre dossier",
      "de candidature — l'appel à propositions de la Cohorte 1 ferme le {{dateCloture}}.",
      '',
      "Ce que cela demande : un formulaire en quatre étapes, qui s'enregistre en brouillon à",
      "chaque étape. Vous pouvez le commencer aujourd'hui, le laisser, et le reprendre autant de",
      'fois que nécessaire — rien ne se perd, et rien n’est transmis avant que vous cliquiez sur',
      '« Soumettre le dossier ».',
      '',
      "{{dossierUrl}}",
      '',
      "N'ATTENDEZ PAS D'AVOIR TOUTES LES PIÈCES POUR COMMENCER. Les documents se déposent à la",
      "dernière étape : vous pouvez décrire votre projet maintenant et les joindre au fur et à",
      'mesure. Voici ce qu’il vous faudra réunir d’ici la clôture ({{nbTotal}} pièces, dont',
      '{{nbObligatoires}} obligatoires) :',
      '',
      '{{piecesTexte}}',
      '',
      'Les mentions : « obligatoire » = exigée pour un dossier complet ; « si applicable » =',
      'seulement si votre projet est concerné ; « si disponible » = à joindre si vous en disposez.',
      '',
      "UNE QUESTION — sur une pièce, sur votre éligibilité, sur le montant demandé ? Sollicitez-nous",
      "autant que nécessaire :",
      '',
      '  - par e-mail : candidature@subco-prete.bi',
      "  - depuis l'espace opérateur, rubrique Assistance (votre demande est suivie et tracée)",
      '  - sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit',
      '',
      "Vous n'êtes pas encore sur les groupes WhatsApp ? Demandez votre inscription à",
      'Mme Euphrasie BIGIRIMANA, +257 79 22 23 00.',
      '',
      "{{#if joursTexte}}Il vous reste {{joursTexte}} pour déposer. Nous serions heureux d'examiner votre projet.{{/if}}",
      '',
      "L'équipe SUBCO-PRETE",
    ].join('\n'),
    html: layout(`
      <p>Bonjour{{#if orgName}} <strong>{{orgName}}</strong>{{/if}},</p>
      <p>Vous avez créé votre compte sur la plateforme des subventions de contrepartie PRETE et confirmé
         votre adresse : <strong>tout est prêt de votre côté</strong>. Il vous reste à ouvrir votre dossier
         de candidature — l'appel à propositions de la Cohorte 1 ferme le <strong>{{dateCloture}}</strong>.</p>
      <p>Ce que cela demande : un formulaire en <strong>quatre étapes</strong>, qui s'enregistre en brouillon
         à chaque étape. Vous pouvez le commencer aujourd'hui, le laisser, et le reprendre autant de fois que
         nécessaire — rien ne se perd, et rien n'est transmis avant que vous cliquiez sur
         « Soumettre le dossier ».</p>
      ${button('Ouvrir mon dossier', '{{{dossierUrl}}}')}
      <p style="margin:22px 0;padding:14px 16px;background:#eef7f4;border-left:4px solid #0fa37f;border-radius:6px;">
        <strong>N'attendez pas d'avoir toutes les pièces pour commencer.</strong> Les documents se déposent à
        la dernière étape : décrivez votre projet maintenant, joignez-les au fur et à mesure.
      </p>
      <p>Voici ce qu'il vous faudra réunir d'ici la clôture — <strong>{{nbTotalTexte}}</strong>, dont
         <strong>{{nbObligatoires}} obligatoires</strong> :</p>
      {{{piecesHtml}}}
      <div style="margin:24px 0 0;padding:16px 18px;background:#eef7f4;border-radius:10px;">
        <p style="margin:0 0 10px;"><strong>Une question ?</strong> Sur une pièce, sur votre éligibilité, sur
           le montant à demander — sollicitez-nous autant que nécessaire :</p>
        <ul style="margin:0 0 10px;padding-left:20px;line-height:1.8;">
          <li>Par e-mail : <a href="mailto:candidature@subco-prete.bi" style="color:#0fa37f;">candidature@subco-prete.bi</a></li>
          <li>Depuis l'espace opérateur, rubrique <em>Assistance</em> — votre demande y est suivie et tracée</li>
          <li>Sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit</li>
        </ul>
        <p style="margin:0;font-size:13px;color:#4b5563;">Pas encore sur les groupes WhatsApp ? Demandez votre
           inscription à <strong>Mme Euphrasie BIGIRIMANA</strong>, <a href="tel:+25779222300" style="color:#0fa37f;">+257 79 22 23 00</a>.</p>
      </div>
      {{#if joursTexte}}<p style="margin:22px 0 0;font-size:15px;">Il vous reste <strong>{{joursTexte}}</strong>
         pour déposer. Nous serions heureux d'examiner votre projet.</p>{{/if}}
      <p style="font-size:13px;color:#6b7280;">Le détail du dossier est présenté sur
         <a href="{{portalUrl}}/candidature" style="color:#0fa37f;">{{portalUrl}}/candidature</a>.</p>
    `),
  },

  // Population 3 du bilan : compte cree, adresse JAMAIS confirmee. Le template natif
  // `auth.account_confirmation` porterait bien le lien, mais son texte suppose une
  // inscription a l'instant. Ici l'inscription date de plusieurs jours et le premier
  // message n'a pas produit d'effet — soit il n'est jamais arrive, soit il a ete lu sans
  // etre compris. Le texte doit donc faire trois choses que le natif ne fait pas :
  // valoriser la demarche deja faite, EXPLIQUER ce que le compte en sommeil empeche, et
  // dedouaner le destinataire d'un echec qui n'est probablement pas le sien.
  'campagne.compte_non_confirme': {
    category: 'campagne',
    description: "Relance d'un inscrit dont l'adresse n'a jamais ete confirmee (lien neuf).",
    requiredVars: ['confirmationUrl', 'dateCloture'],
    subject: `${BRAND_NAME} — Il ne manque qu'un clic pour activer votre compte`,
    text: [
      'Bonjour{{#if orgName}} {{orgName}}{{/if}},',
      '',
      "Vous avez créé un compte{{#if dateInscription}} le {{dateInscription}}{{/if}} sur la plateforme",
      "des subventions de contrepartie PRETE. C'est une démarche que beaucoup remettent à plus tard :",
      "vous, vous l'avez faite.",
      '',
      "Il manque une seule chose, et elle prend une seconde : confirmer votre adresse e-mail. Tant",
      "que ce n'est pas fait, votre compte reste en sommeil — vous ne pouvez ni vous connecter, ni",
      'ouvrir un dossier de candidature.',
      '',
      'Activez votre compte ici :',
      '{{confirmationUrl}}',
      '',
      "Il n'y a rien à saisir : le lien fait tout. Si notre premier message ne vous est jamais",
      "parvenu, ce n'est pas de votre fait — regardez éventuellement dans vos courriers indésirables.",
      'Ce lien-ci est neuf et remplace tout lien précédent.',
      '',
      'CE QUI VOUS ATTEND ENSUITE. Un formulaire en quatre étapes, qui s’enregistre en brouillon :',
      'vous le commencez, vous le laissez, vous le reprenez. Les pièces justificatives ne se déposent',
      "qu'à la dernière étape — inutile de les avoir réunies pour démarrer. L'appel à propositions de",
      'la Cohorte 1 ferme le {{dateCloture}}.',
      '',
      "UNE QUESTION — sur votre éligibilité, sur les pièces, sur le montant demandé ? Sollicitez-nous",
      "autant que nécessaire :",
      '',
      '  - par e-mail : candidature@subco-prete.bi',
      '  - sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit',
      '',
      "Vous n'êtes pas encore sur les groupes WhatsApp ? Demandez votre inscription à",
      'Mme Euphrasie BIGIRIMANA, +257 79 22 23 00.',
      '',
      "{{#if joursTexte}}Il vous reste {{joursTexte}} pour déposer un dossier. Nous serions heureux d'examiner votre projet.{{/if}}",
      '',
      "L'équipe SUBCO-PRETE",
    ].join('\n'),
    html: layout(`
      <p>Bonjour{{#if orgName}} <strong>{{orgName}}</strong>{{/if}},</p>
      <p>Vous avez créé un compte{{#if dateInscription}} le <strong>{{dateInscription}}</strong>{{/if}} sur la
         plateforme des subventions de contrepartie PRETE. C'est une démarche que beaucoup remettent à plus
         tard : vous, vous l'avez faite.</p>
      <p>Il manque une seule chose, et elle prend une seconde : <strong>confirmer votre adresse e-mail</strong>.
         Tant que ce n'est pas fait, votre compte reste en sommeil — vous ne pouvez ni vous connecter, ni ouvrir
         un dossier de candidature.</p>
      ${button('Activer mon compte', '{{{confirmationUrl}}}')}
      <p style="font-size:13px;color:#6b7280;">Il n'y a rien à saisir : le lien fait tout. Si notre premier
         message ne vous est jamais parvenu, ce n'est pas de votre fait — regardez éventuellement dans vos
         courriers indésirables. Ce lien-ci est neuf et remplace tout lien précédent.</p>
      <p style="margin:22px 0;padding:14px 16px;background:#eef7f4;border-left:4px solid #0fa37f;border-radius:6px;">
        <strong>Ce qui vous attend ensuite.</strong> Un formulaire en quatre étapes, qui s'enregistre en
        brouillon : vous le commencez, vous le laissez, vous le reprenez. Les pièces justificatives ne se
        déposent qu'à la dernière étape — inutile de les avoir réunies pour démarrer.
        L'appel ferme le <strong>{{dateCloture}}</strong>.
      </p>
      <div style="margin:24px 0 0;padding:16px 18px;background:#eef7f4;border-radius:10px;">
        <p style="margin:0 0 10px;"><strong>Une question ?</strong> Sur votre éligibilité, sur les pièces, sur
           le montant à demander — sollicitez-nous autant que nécessaire :</p>
        <ul style="margin:0 0 10px;padding-left:20px;line-height:1.8;">
          <li>Par e-mail : <a href="mailto:candidature@subco-prete.bi" style="color:#0fa37f;">candidature@subco-prete.bi</a></li>
          <li>Sur les groupes WhatsApp du projet, si vous y êtes déjà inscrit</li>
        </ul>
        <p style="margin:0;font-size:13px;color:#4b5563;">Pas encore sur les groupes WhatsApp ? Demandez votre
           inscription à <strong>Mme Euphrasie BIGIRIMANA</strong>, <a href="tel:+25779222300" style="color:#0fa37f;">+257 79 22 23 00</a>.</p>
      </div>
      {{#if joursTexte}}<p style="margin:22px 0 0;font-size:15px;">Il vous reste <strong>{{joursTexte}}</strong>
         pour déposer un dossier. Nous serions heureux d'examiner votre projet.</p>{{/if}}
    `),
  },

  // Population 1 du bilan : abonnes a la liste d'annonce (consentement donne), notifies a
  // l'ouverture le 20/08, jamais inscrits. C'est le public le plus FROID des quatre — il
  // n'a aucun compte, aucun dossier, aucun engagement au-dela d'une case cochee. Trois
  // consequences sur le texte :
  //  - il est le plus COURT : on ne fait pas lire trente lignes a qui n'a rien commence ;
  //  - il ne liste PAS les pieces (ce serait le mur qui a deja fait fuir la population 2) ;
  //  - il porte un lien de DESINSCRIPTION visible, et l'appelant pose un List-Unsubscribe.
  //    Sur une liste froide, offrir la sortie protege la reputation d'expediteur bien mieux
  //    que de la cacher : une desinscription vaut infiniment moins cher qu'un signalement.
  'campagne.appel_ouvert_rappel': {
    category: 'campagne',
    description: "Rappel de l'appel ouvert aux abonnes de la liste d'annonce jamais inscrits.",
    requiredVars: ['dateCloture', 'inscriptionUrl', 'unsubscribeUrl'],
    subject: `${BRAND_NAME} — L'appel à propositions ferme le {{dateCloture}}`,
    text: [
      'Bonjour,',
      '',
      "Vous nous avez demandé d'être informé de l'ouverture des appels à propositions du programme",
      "PRETE. Celui de la Cohorte 1 est ouvert depuis le 20 août{{#if joursTexte}}, et il ferme dans {{joursTexte}}{{/if}} —",
      'le {{dateCloture}}.',
      '',
      "DE QUOI S'AGIT-IL. D'une subvention de contrepartie : le programme cofinance un investissement",
      'productif dont vous mobilisez une part. Sont éligibles les sociétés, coopératives, associations,',
      'ONG et fournisseurs de services liés au dispositif, dont le projet répond aux territoires et',
      "priorités définis dans l'appel.",
      '',
      "PAS SÛR D'ÊTRE ÉLIGIBLE ? Le test prend deux minutes et ne demande pas de compte :",
      '{{portalUrl}}/eligibilite',
      '',
      'SI VOUS L’ÊTES, créer votre compte prend cinq minutes :',
      '{{inscriptionUrl}}',
      '',
      "Le dossier se remplit ensuite en quatre étapes, s'enregistre en brouillon à chaque étape, et",
      "les pièces justificatives ne se déposent qu'à la fin — vous pouvez commencer aujourd'hui sans",
      'les avoir réunies.',
      '',
      "UNE QUESTION — sur votre éligibilité, sur le montant, sur les pièces : écrivez à",
      'candidature@subco-prete.bi, ou demandez votre inscription aux groupes WhatsApp du projet',
      'auprès de Mme Euphrasie BIGIRIMANA, +257 79 22 23 00.',
      '',
      '—',
      "Vous recevez ce message parce que vous vous êtes inscrit aux alertes d'appels à propositions.",
      'Pour ne plus les recevoir : {{unsubscribeUrl}}',
    ].join('\n'),
    html: layout(`
      <p>Bonjour,</p>
      <p>Vous nous avez demandé d'être informé de l'ouverture des appels à propositions du programme PRETE.
         Celui de la <strong>Cohorte 1</strong> est ouvert depuis le 20 août{{#if joursTexte}}, et il ferme
         <strong>dans {{joursTexte}}</strong>{{/if}} — le <strong>{{dateCloture}}</strong>.</p>
      <p><strong>De quoi s'agit-il ?</strong> D'une subvention de contrepartie : le programme cofinance un
         investissement productif dont vous mobilisez une part. Sont éligibles les sociétés, coopératives,
         associations, ONG et fournisseurs de services liés au dispositif, dont le projet répond aux
         territoires et priorités définis dans l'appel.</p>
      <p style="margin:22px 0;padding:14px 16px;background:#eef7f4;border-left:4px solid #0fa37f;border-radius:6px;">
        <strong>Pas sûr d'être éligible ?</strong> Le test prend deux minutes et ne demande pas de compte :
        <a href="{{portalUrl}}/eligibilite" style="color:#0fa37f;">{{portalUrl}}/eligibilite</a>
      </p>
      ${button('Créer mon compte', '{{{inscriptionUrl}}}')}
      <p>Le dossier se remplit ensuite en <strong>quatre étapes</strong>, s'enregistre en brouillon, et les
         pièces justificatives ne se déposent qu'à la fin — vous pouvez commencer aujourd'hui sans les avoir
         réunies.</p>
      <p style="font-size:13px;color:#6b7280;">Une question sur votre éligibilité, sur le montant, sur les
         pièces ? Écrivez à <a href="mailto:candidature@subco-prete.bi" style="color:#0fa37f;">candidature@subco-prete.bi</a>,
         ou demandez votre inscription aux groupes WhatsApp du projet auprès de <strong>Mme Euphrasie BIGIRIMANA</strong>,
         <a href="tel:+25779222300" style="color:#0fa37f;">+257 79 22 23 00</a>.</p>
      <p style="margin-top:22px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
        Vous recevez ce message parce que vous vous êtes inscrit aux alertes d'appels à propositions.
        <a href="{{{unsubscribeUrl}}}" style="color:#9ca3af;text-decoration:underline;">Ne plus recevoir ces messages</a>.
      </p>
    `),
  },
};

function getCodeTemplate(key) {
  return TEMPLATES[key] || null;
}

function listTemplateKeys() {
  return Object.keys(TEMPLATES);
}

module.exports = { TEMPLATES, getCodeTemplate, listTemplateKeys, layout, BRAND_NAME };
