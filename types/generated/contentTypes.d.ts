import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiAboutPageAboutPage extends Struct.SingleTypeSchema {
  collectionName: 'about_pages';
  info: {
    displayName: 'About Page';
    pluralName: 'about-pages';
    singularName: 'about-page';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    briefItems: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    institutionalItems: Schema.Attribute.JSON;
    intro: Schema.Attribute.Text;
    kicker: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'\u00C0 propos'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::about-page.about-page'
    > &
      Schema.Attribute.Private;
    platformItems: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    sections: Schema.Attribute.JSON;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiAppelAppel extends Struct.CollectionTypeSchema {
  collectionName: 'appels';
  info: {
    displayName: 'Appel';
    pluralName: 'appels';
    singularName: 'appel';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    clotureLe: Schema.Attribute.Date;
    codeCohorte: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::appel.appel'> &
      Schema.Attribute.Private;
    nom: Schema.Attribute.String & Schema.Attribute.Required;
    ouvertLe: Schema.Attribute.Date;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<['ouvert', 'ferme', 'a_venir']> &
      Schema.Attribute.DefaultTo<'a_venir'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiApplicationApplication extends Struct.CollectionTypeSchema {
  collectionName: 'applications';
  info: {
    displayName: 'Application';
    pluralName: 'applications';
    singularName: 'application';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    activities: Schema.Attribute.JSON;
    address: Schema.Attribute.Text;
    age: Schema.Attribute.Integer;
    applicationDocuments: Schema.Attribute.Media<'files' | 'images', true>;
    commercialName: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    creationDate: Schema.Attribute.Date;
    creditInterest: Schema.Attribute.Boolean;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    financialAccountStatus: Schema.Attribute.Text;
    fullName: Schema.Attribute.String & Schema.Attribute.Required;
    gender: Schema.Attribute.Enumeration<
      ['femme', 'homme', 'autre', 'non_precise']
    >;
    investmentProject: Schema.Attribute.JSON;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::application.application'
    > &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    operatingData: Schema.Attribute.JSON;
    organization: Schema.Attribute.String & Schema.Attribute.Required;
    organizationProfile: Schema.Attribute.JSON;
    organizationType: Schema.Attribute.String;
    ownContributionEstimate: Schema.Attribute.BigInteger;
    partners: Schema.Attribute.JSON;
    phone: Schema.Attribute.String;
    projectSummary: Schema.Attribute.Text & Schema.Attribute.Required;
    projectTitle: Schema.Attribute.String & Schema.Attribute.Required;
    promoterProfile: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    reference: Schema.Attribute.UID<'projectTitle'>;
    requestedSupportEstimate: Schema.Attribute.BigInteger;
    risksAndEnvironment: Schema.Attribute.JSON;
    status: Schema.Attribute.Enumeration<
      [
        'draft',
        'submitted',
        'received',
        'incomplete',
        'additional_info_requested',
        'completed',
        'under_admin_review',
        'preselected',
        'not_preselected',
        'committee_review',
        'approved',
        'rejected',
      ]
    > &
      Schema.Attribute.DefaultTo<'submitted'>;
    strengthsWeaknesses: Schema.Attribute.JSON;
    submittedAt: Schema.Attribute.DateTime;
    targetObjectives: Schema.Attribute.JSON;
    umbrellaOrganizations: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    valueChain: Schema.Attribute.Enumeration<
      ['fruits', 'volaille', 'lait', 'pisciculture', 'mines']
    > &
      Schema.Attribute.Required;
    yearsOfActivity: Schema.Attribute.Integer;
  };
}

export interface ApiCallForProposalCallForProposal
  extends Struct.CollectionTypeSchema {
  collectionName: 'call_for_proposals';
  info: {
    displayName: 'Call For Proposal';
    pluralName: 'call-for-proposals';
    singularName: 'call-for-proposal';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    callStatus: Schema.Attribute.Enumeration<['draft', 'open', 'closed']> &
      Schema.Attribute.DefaultTo<'draft'>;
    content: Schema.Attribute.Blocks;
    coverImage: Schema.Attribute.Media<'images'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deadlineDate: Schema.Attribute.Date;
    documents: Schema.Attribute.Media<'files', true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::call-for-proposal.call-for-proposal'
    > &
      Schema.Attribute.Private;
    openingDate: Schema.Attribute.Date;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'title'> & Schema.Attribute.Required;
    summary: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCandidatureGuideCandidatureGuide
  extends Struct.SingleTypeSchema {
  collectionName: 'candidature_guides';
  info: {
    displayName: 'Candidature Guide';
    pluralName: 'candidature-guides';
    singularName: 'candidature-guide';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    documentItems: Schema.Attribute.JSON;
    eligibilityItems: Schema.Attribute.JSON;
    formStepItems: Schema.Attribute.JSON;
    intro: Schema.Attribute.Text;
    kicker: Schema.Attribute.String & Schema.Attribute.DefaultTo<'Candidature'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::candidature-guide.candidature-guide'
    > &
      Schema.Attribute.Private;
    preStartItems: Schema.Attribute.JSON;
    primaryCtaLabel: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'D\u00E9poser une candidature'>;
    primaryCtaUrl: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'/candidature/deposer'>;
    projectProofItems: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    riskItems: Schema.Attribute.JSON;
    sections: Schema.Attribute.JSON;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCandidatureCandidature extends Struct.CollectionTypeSchema {
  collectionName: 'candidatures_portail';
  info: {
    displayName: 'Candidature';
    pluralName: 'candidatures';
    singularName: 'candidature';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    appel: Schema.Attribute.Relation<'manyToOne', 'api::appel.appel'>;
    complements: Schema.Attribute.Relation<
      'oneToMany',
      'api::complement.complement'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateDepot: Schema.Attribute.DateTime;
    donneesProjet: Schema.Attribute.JSON;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::candidature.candidature'
    > &
      Schema.Attribute.Private;
    motifDecisionCourt: Schema.Attribute.Text;
    notificationDecision: Schema.Attribute.Media<'files' | 'images'>;
    notifications: Schema.Attribute.Relation<
      'oneToMany',
      'api::notification.notification'
    >;
    numeroDossier: Schema.Attribute.String;
    organisation: Schema.Attribute.Relation<
      'manyToOne',
      'api::organisation.organisation'
    >;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    pdfPermanent: Schema.Attribute.Media<'files'>;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Relation<
      'manyToOne',
      'api::statut-candidature.statut-candidature'
    >;
    titreProjet: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCommuneCommune extends Struct.CollectionTypeSchema {
  collectionName: 'communes_reforme_2025';
  info: {
    displayName: 'Commune';
    pluralName: 'communes';
    singularName: 'commune';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::commune.commune'
    > &
      Schema.Attribute.Private;
    nom: Schema.Attribute.String & Schema.Attribute.Required;
    province: Schema.Attribute.Relation<'manyToOne', 'api::province.province'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiComplaintRecourseComplaintRecourse
  extends Struct.CollectionTypeSchema {
  collectionName: 'complaint_recourses';
  info: {
    displayName: 'Complaint Recourse';
    pluralName: 'complaint-recourses';
    singularName: 'complaint-recourse';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    details: Schema.Attribute.Text & Schema.Attribute.Required;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    fullName: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::complaint-recourse.complaint-recourse'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    relatedSubmissionRef: Schema.Attribute.String;
    status: Schema.Attribute.Enumeration<
      ['received', 'under_review', 'resolved', 'closed']
    > &
      Schema.Attribute.DefaultTo<'received'>;
    subject: Schema.Attribute.String & Schema.Attribute.Required;
    supportingDocuments: Schema.Attribute.Media<'files' | 'images', true>;
    type: Schema.Attribute.Enumeration<['complaint', 'recourse', 'eas_hs']> &
      Schema.Attribute.DefaultTo<'complaint'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiComplementComplement extends Struct.CollectionTypeSchema {
  collectionName: 'complements_portail';
  info: {
    displayName: 'Complement';
    pluralName: 'complements';
    singularName: 'complement';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    candidature: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidature.candidature'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    echeance: Schema.Attribute.Date;
    fichier: Schema.Attribute.Media<'files' | 'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::complement.complement'
    > &
      Schema.Attribute.Private;
    pieceDemandee: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<['demande', 'fourni']> &
      Schema.Attribute.DefaultTo<'demande'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiConditionPrealableConditionPrealable
  extends Struct.CollectionTypeSchema {
  collectionName: 'conditions_prealables';
  info: {
    displayName: 'Condition prealable';
    pluralName: 'conditions-prealables';
    singularName: 'condition-prealable';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateValidation: Schema.Attribute.Date;
    echeance: Schema.Attribute.Date;
    fichierDepose: Schema.Attribute.Media<'files' | 'images'>;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::condition-prealable.condition-prealable'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<
      ['validee', 'en_cours_ugp', 'action_requise']
    > &
      Schema.Attribute.DefaultTo<'en_cours_ugp'>;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiContenuAideContenuAide extends Struct.CollectionTypeSchema {
  collectionName: 'contenus_aide';
  info: {
    displayName: 'Contenu aide';
    pluralName: 'contenus-aide';
    singularName: 'contenu-aide';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    cle: Schema.Attribute.UID<'titre'> & Schema.Attribute.Required;
    corps: Schema.Attribute.Blocks;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::contenu-aide.contenu-aide'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    titre: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiDemandeDecaissementDemandeDecaissement
  extends Struct.CollectionTypeSchema {
  collectionName: 'demandes_decaissement';
  info: {
    displayName: 'Demande decaissement';
    pluralName: 'demandes-decaissement';
    singularName: 'demande-decaissement';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    aJustifier: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    avisFiduciaire: Schema.Attribute.Enumeration<
      ['approuve', 'rejete', 'complements']
    >;
    avisTechnique: Schema.Attribute.Enumeration<
      ['favorable', 'defavorable', 'favorable_reserve']
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    justificationPieces: Schema.Attribute.Media<'files' | 'images', true>;
    justificationStatut: Schema.Attribute.Enumeration<
      ['non_requise', 'attendue', 'soumise', 'validee']
    > &
      Schema.Attribute.DefaultTo<'non_requise'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::demande-decaissement.demande-decaissement'
    > &
      Schema.Attribute.Private;
    modalite: Schema.Attribute.Relation<
      'manyToOne',
      'api::modalite-decaissement.modalite-decaissement'
    >;
    montant: Schema.Attribute.BigInteger;
    motifRejet: Schema.Attribute.Text;
    numero: Schema.Attribute.Integer;
    objet: Schema.Attribute.Text;
    pieces: Schema.Attribute.Media<'files' | 'images', true>;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Relation<
      'manyToOne',
      'api::statut-demande.statut-demande'
    >;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiDocumentContractuelDocumentContractuel
  extends Struct.CollectionTypeSchema {
  collectionName: 'documents_contractuels';
  info: {
    displayName: 'Document contractuel';
    pluralName: 'documents-contractuels';
    singularName: 'document-contractuel';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    fichier: Schema.Attribute.Media<'files'>;
    lettre: Schema.Attribute.Enumeration<
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::document-contractuel.document-contractuel'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    titre: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiDocumentTelechargeableDocumentTelechargeable
  extends Struct.CollectionTypeSchema {
  collectionName: 'documents_telechargeables';
  info: {
    displayName: 'Document telechargeable';
    pluralName: 'documents-telechargeables';
    singularName: 'document-telechargeable';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    fichier: Schema.Attribute.Media<'files' | 'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::document-telechargeable.document-telechargeable'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    titre: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEtapeContractuelleEtapeContractuelle
  extends Struct.CollectionTypeSchema {
  collectionName: 'etapes_contractuelles';
  info: {
    displayName: 'Etape contractuelle';
    pluralName: 'etapes-contractuelles';
    singularName: 'etape-contractuelle';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::etape-contractuelle.etape-contractuelle'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEtapeProgrammeEtapeProgramme
  extends Struct.CollectionTypeSchema {
  collectionName: 'etape_programmes';
  info: {
    description: '\u00C9tapes de calendrier des cohortes du programme SUBCO PRETE';
    displayName: '\u00C9tape programme';
    pluralName: 'etape-programmes';
    singularName: 'etape-programme';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    cohorte: Schema.Attribute.Enumeration<
      ['cohorte-1', 'cohorte-2', 'cohorte-3']
    > &
      Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    date_affichee: Schema.Attribute.String & Schema.Attribute.Required;
    description: Schema.Attribute.Text;
    lien_label: Schema.Attribute.String;
    lien_url: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::etape-programme.etape-programme'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<['termine', 'en-cours', 'a-venir']> &
      Schema.Attribute.Required;
    titre: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEventEvent extends Struct.CollectionTypeSchema {
  collectionName: 'events';
  info: {
    displayName: 'Event';
    pluralName: 'events';
    singularName: 'event';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Blocks;
    eventDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    image: Schema.Attribute.Media<'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::event.event'> &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationUrl: Schema.Attribute.String;
    slug: Schema.Attribute.UID<'title'> & Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFaqEntreeFaqEntree extends Struct.CollectionTypeSchema {
  collectionName: 'faq_entrees';
  info: {
    displayName: 'FAQ entree';
    pluralName: 'faq-entrees';
    singularName: 'faq-entree';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::faq-entree.faq-entree'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    reponse: Schema.Attribute.Blocks;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFaqItemFaqItem extends Struct.CollectionTypeSchema {
  collectionName: 'faq_items';
  info: {
    description: "Questions fr\u00E9quentes th\u00E9matiques affich\u00E9es sur la page d'accueil et la page FAQ";
    displayName: 'FAQ Item';
    pluralName: 'faq-items';
    singularName: 'faq-item';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::faq-item.faq-item'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.Required;
    publie: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    publishedAt: Schema.Attribute.DateTime;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    reponse: Schema.Attribute.Blocks & Schema.Attribute.Required;
    theme: Schema.Attribute.Enumeration<
      ['eligibilite', 'dossier', 'financement', 'selection']
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFaqFaq extends Struct.CollectionTypeSchema {
  collectionName: 'faqs';
  info: {
    displayName: 'FAQ';
    pluralName: 'faqs';
    singularName: 'faq';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    answer: Schema.Attribute.Blocks & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::faq.faq'> &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFiliereFiliere extends Struct.CollectionTypeSchema {
  collectionName: 'filieres';
  info: {
    displayName: 'Filiere';
    pluralName: 'filieres';
    singularName: 'filiere';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::filiere.filiere'
    > &
      Schema.Attribute.Private;
    nom: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'nom'> & Schema.Attribute.Required;
    transversal: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFooterLinkFooterLink extends Struct.CollectionTypeSchema {
  collectionName: 'footer_links';
  info: {
    displayName: 'Footer Link';
    pluralName: 'footer-links';
    singularName: 'footer-link';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    group: Schema.Attribute.Enumeration<
      [
        'assistance',
        'institutional',
        'resources',
        'programme',
        'candidater',
        'aide',
        'legal',
      ]
    > &
      Schema.Attribute.Required;
    isVisible: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::footer-link.footer-link'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ApiHomepageHomepage extends Struct.SingleTypeSchema {
  collectionName: 'homepages';
  info: {
    displayName: 'Homepage';
    pluralName: 'homepages';
    singularName: 'homepage';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ctaLabel: Schema.Attribute.String;
    ctaUrl: Schema.Attribute.String;
    heroImage: Schema.Attribute.Media<'images'>;
    heroSubtitle: Schema.Attribute.Text;
    heroTitle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::homepage.homepage'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInfrastructureBandInfrastructureBand
  extends Struct.SingleTypeSchema {
  collectionName: 'infrastructure_band';
  info: {
    displayName: 'Bande Infrastructures';
    pluralName: 'infrastructure-bands';
    singularName: 'infrastructure-band';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    intro: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::infrastructure-band.infrastructure-band'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInfrastructureTypeInfrastructureType
  extends Struct.CollectionTypeSchema {
  collectionName: 'infrastructure_types';
  info: {
    displayName: "Type d'infrastructure";
    pluralName: 'infrastructure-types';
    singularName: 'infrastructure-type';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    body: Schema.Attribute.Blocks & Schema.Attribute.Required;
    cardText: Schema.Attribute.Text & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    highlight: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    icon: Schema.Attribute.String & Schema.Attribute.Required;
    lead: Schema.Attribute.Text & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::infrastructure-type.infrastructure-type'
    > &
      Schema.Attribute.Private;
    nature: Schema.Attribute.Enumeration<
      ['physique', 'immaterielle', 'mixte']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'physique'>;
    order: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'title'> &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiJalonProjetJalonProjet extends Struct.CollectionTypeSchema {
  collectionName: 'jalons_projet';
  info: {
    displayName: 'Jalon projet';
    pluralName: 'jalons-projet';
    singularName: 'jalon-projet';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    datePrevue: Schema.Attribute.Date;
    dateReelle: Schema.Attribute.Date;
    etape: Schema.Attribute.Relation<
      'manyToOne',
      'api::etape-contractuelle.etape-contractuelle'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::jalon-projet.jalon-projet'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMesureCorrectiveMesureCorrective
  extends Struct.CollectionTypeSchema {
  collectionName: 'mesures_correctives';
  info: {
    displayName: 'Mesure corrective';
    pluralName: 'mesures-correctives';
    singularName: 'mesure-corrective';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    echeance: Schema.Attribute.Date;
    fichierRegularisation: Schema.Attribute.Media<'files' | 'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::mesure-corrective.mesure-corrective'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<['en_cours', 'regularisee']> &
      Schema.Attribute.DefaultTo<'en_cours'>;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiModaliteDecaissementModaliteDecaissement
  extends Struct.CollectionTypeSchema {
  collectionName: 'modalites_decaissement';
  info: {
    displayName: 'Modalite decaissement';
    pluralName: 'modalites-decaissement';
    singularName: 'modalite-decaissement';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::modalite-decaissement.modalite-decaissement'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    piecesRequises: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiNewsNews extends Struct.CollectionTypeSchema {
  collectionName: 'news';
  info: {
    displayName: 'News';
    pluralName: 'news-items';
    singularName: 'news';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    category: Schema.Attribute.Enumeration<
      ['actualite', 'communique', 'annonce_resultat']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'actualite'>;
    content: Schema.Attribute.Blocks;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    excerpt: Schema.Attribute.Text;
    image: Schema.Attribute.Media<'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::news.news'> &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    publishedAtCustom: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'title'> & Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiNotificationAmiNotificationAmi
  extends Struct.CollectionTypeSchema {
  collectionName: 'notification_amis';
  info: {
    description: "Emails \u00E0 notifier lors de l'ouverture du prochain appel \u00E0 propositions";
    displayName: 'Notification AMI';
    pluralName: 'notification-amis';
    singularName: 'notification-ami';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    cohorte_cible: Schema.Attribute.String;
    consentement: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::notification-ami.notification-ami'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    statut_notif: Schema.Attribute.Enumeration<
      ['en-attente', 'notifie', 'desabonne']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'en-attente'>;
    token_desinscription: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiNotificationNotification
  extends Struct.CollectionTypeSchema {
  collectionName: 'notifications_portail';
  info: {
    displayName: 'Notification';
    pluralName: 'notifications';
    singularName: 'notification';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    canal: Schema.Attribute.Enumeration<['email', 'sms', 'both']> &
      Schema.Attribute.DefaultTo<'email'>;
    candidature: Schema.Attribute.Relation<
      'manyToOne',
      'api::candidature.candidature'
    >;
    corps: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    envoyeLe: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::notification.notification'
    > &
      Schema.Attribute.Private;
    lu: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    publishedAt: Schema.Attribute.DateTime;
    sujet: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrganisationOrganisation
  extends Struct.CollectionTypeSchema {
  collectionName: 'organisations_portail';
  info: {
    displayName: 'Organisation';
    pluralName: 'organisations';
    singularName: 'organisation';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    adresse: Schema.Attribute.Text;
    commune: Schema.Attribute.Relation<'manyToOne', 'api::commune.commune'>;
    contact: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    filierePrincipale: Schema.Attribute.Relation<
      'manyToOne',
      'api::filiere.filiere'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organisation.organisation'
    > &
      Schema.Attribute.Private;
    nom: Schema.Attribute.String & Schema.Attribute.Required;
    owner: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
    province: Schema.Attribute.Relation<'manyToOne', 'api::province.province'>;
    publishedAt: Schema.Attribute.DateTime;
    statutJuridique: Schema.Attribute.Relation<
      'manyToOne',
      'api::statut-juridique.statut-juridique'
    >;
    telephone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPartnerPartner extends Struct.CollectionTypeSchema {
  collectionName: 'partners';
  info: {
    displayName: 'Partner';
    pluralName: 'partners';
    singularName: 'partner';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    isVisible: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::partner.partner'
    > &
      Schema.Attribute.Private;
    logo: Schema.Attribute.Media<'images'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    websiteUrl: Schema.Attribute.String;
  };
}

export interface ApiProvinceProvince extends Struct.CollectionTypeSchema {
  collectionName: 'provinces_reforme_2025';
  info: {
    displayName: 'Province';
    pluralName: 'provinces';
    singularName: 'province';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    anciensNoms: Schema.Attribute.JSON;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    communes: Schema.Attribute.Relation<'oneToMany', 'api::commune.commune'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::province.province'
    > &
      Schema.Attribute.Private;
    nom: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiRapportRequisRapportRequis
  extends Struct.CollectionTypeSchema {
  collectionName: 'rapports_requis';
  info: {
    displayName: 'Rapport requis';
    pluralName: 'rapports-requis';
    singularName: 'rapport-requis';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateTransmission: Schema.Attribute.Date;
    echeance: Schema.Attribute.Date;
    fichier: Schema.Attribute.Media<'files'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::rapport-requis.rapport-requis'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    periodeLibelle: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    statut: Schema.Attribute.Enumeration<['a_venir', 'echu', 'transmis']> &
      Schema.Attribute.DefaultTo<'a_venir'>;
    subvention: Schema.Attribute.Relation<
      'manyToOne',
      'api::subvention.subvention'
    >;
    type: Schema.Attribute.Relation<
      'manyToOne',
      'api::type-rapport.type-rapport'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiResourceDocumentResourceDocument
  extends Struct.CollectionTypeSchema {
  collectionName: 'resource_documents';
  info: {
    displayName: 'Resource Document';
    pluralName: 'resource-documents';
    singularName: 'resource-document';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    category: Schema.Attribute.Enumeration<
      [
        'appel',
        'tdr',
        'formulaire',
        'modele',
        'guide',
        'grille',
        'manuel',
        'note',
        'rapport',
        'autre',
      ]
    > &
      Schema.Attribute.DefaultTo<'autre'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    file: Schema.Attribute.Media<'files'> & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::resource-document.resource-document'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSiteNavigationSiteNavigation
  extends Struct.SingleTypeSchema {
  collectionName: 'site_navigations';
  info: {
    displayName: 'Site Navigation';
    pluralName: 'site-navigations';
    singularName: 'site-navigation';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    brandLabel: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'SUBCO PRETE'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ctaLabelFr: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Candidater'>;
    ctaLabelRn: Schema.Attribute.String & Schema.Attribute.DefaultTo<'Gusaba'>;
    ctaUrl: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'/candidature/deposer'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::site-navigation.site-navigation'
    > &
      Schema.Attribute.Private;
    newsItems: Schema.Attribute.Component<'navigation.link', true>;
    newsLabelFr: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Actualit\u00E9s'>;
    newsLabelRn: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Amakuru'>;
    primaryItems: Schema.Attribute.Component<'navigation.link', true>;
    publishedAt: Schema.Attribute.DateTime;
    supportLabelFr: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Support / Contact'>;
    supportLabelRn: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Ubufasha / Twandikire'>;
    supportUrl: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'/candidature'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStatutCandidatureStatutCandidature
  extends Struct.CollectionTypeSchema {
  collectionName: 'statuts_candidature_portail';
  info: {
    displayName: 'Statut candidature';
    pluralName: 'statuts-candidature';
    singularName: 'statut-candidature';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    code: Schema.Attribute.UID<'libelleCandidat'> & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    groupe: Schema.Attribute.Enumeration<
      ['brouillon', 'en_instruction', 'selectionne', 'non_retenu']
    > &
      Schema.Attribute.Required;
    libelleCandidat: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::statut-candidature.statut-candidature'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    phase: Schema.Attribute.Enumeration<
      ['recu', 'completude', 'eligibilite', 'evaluation', 'decision']
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStatutDemandeStatutDemande
  extends Struct.CollectionTypeSchema {
  collectionName: 'statuts_demande';
  info: {
    displayName: 'Statut demande';
    pluralName: 'statuts-demande';
    singularName: 'statut-demande';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelleBeneficiaire: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::statut-demande.statut-demande'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStatutJuridiqueStatutJuridique
  extends Struct.CollectionTypeSchema {
  collectionName: 'statuts_juridiques';
  info: {
    displayName: 'Statut juridique';
    pluralName: 'statuts-juridiques';
    singularName: 'statut-juridique';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::statut-juridique.statut-juridique'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSubventionSubvention extends Struct.CollectionTypeSchema {
  collectionName: 'subventions';
  info: {
    displayName: 'Subvention';
    pluralName: 'subventions';
    singularName: 'subvention';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    avenants: Schema.Attribute.Media<'files', true>;
    candidature: Schema.Attribute.Relation<
      'oneToOne',
      'api::candidature.candidature'
    >;
    conditionsPrealables: Schema.Attribute.Relation<
      'oneToMany',
      'api::condition-prealable.condition-prealable'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateSignature: Schema.Attribute.Date;
    demandes: Schema.Attribute.Relation<
      'oneToMany',
      'api::demande-decaissement.demande-decaissement'
    >;
    documentsContractuels: Schema.Attribute.Relation<
      'oneToMany',
      'api::document-contractuel.document-contractuel'
    >;
    jalons: Schema.Attribute.Relation<
      'oneToMany',
      'api::jalon-projet.jalon-projet'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::subvention.subvention'
    > &
      Schema.Attribute.Private;
    mesuresCorrectives: Schema.Attribute.Relation<
      'oneToMany',
      'api::mesure-corrective.mesure-corrective'
    >;
    montantContrepartie: Schema.Attribute.BigInteger;
    montantDecaisse: Schema.Attribute.BigInteger &
      Schema.Attribute.DefaultTo<'0'>;
    montantSubvention: Schema.Attribute.BigInteger;
    montantTotal: Schema.Attribute.BigInteger;
    numeroConvention: Schema.Attribute.String;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    pdfConvention: Schema.Attribute.Media<'files'>;
    publishedAt: Schema.Attribute.DateTime;
    rapports: Schema.Attribute.Relation<
      'oneToMany',
      'api::rapport-requis.rapport-requis'
    >;
    statut: Schema.Attribute.Enumeration<
      ['preparation', 'active', 'suspendue', 'cloturee']
    > &
      Schema.Attribute.DefaultTo<'preparation'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSuccessStorySuccessStory
  extends Struct.CollectionTypeSchema {
  collectionName: 'success_stories';
  info: {
    displayName: 'Success Story';
    pluralName: 'success-stories';
    singularName: 'success-story';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    gallery: Schema.Attribute.Media<'images' | 'videos', true>;
    impactMetrics: Schema.Attribute.JSON;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::success-story.success-story'
    > &
      Schema.Attribute.Private;
    operatorName: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.UID<'title'> & Schema.Attribute.Required;
    story: Schema.Attribute.Blocks;
    summary: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSupportTicketSupportTicket
  extends Struct.CollectionTypeSchema {
  collectionName: 'support_tickets';
  info: {
    displayName: 'Support Ticket';
    pluralName: 'support-tickets';
    singularName: 'support-ticket';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    attachment: Schema.Attribute.Media<'files' | 'images'>;
    category: Schema.Attribute.Enumeration<
      ['technical', 'functional', 'account', 'other']
    > &
      Schema.Attribute.DefaultTo<'other'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    fullName: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::support-ticket.support-ticket'
    > &
      Schema.Attribute.Private;
    message: Schema.Attribute.Text & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['new', 'in_progress', 'resolved', 'closed']
    > &
      Schema.Attribute.DefaultTo<'new'>;
    subject: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTypeContrepartieTypeContrepartie
  extends Struct.CollectionTypeSchema {
  collectionName: 'types_contrepartie';
  info: {
    displayName: 'Type contrepartie';
    pluralName: 'types-contrepartie';
    singularName: 'type-contrepartie';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::type-contrepartie.type-contrepartie'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTypePieceTypePiece extends Struct.CollectionTypeSchema {
  collectionName: 'types_piece';
  info: {
    displayName: 'Type piece';
    pluralName: 'types-piece';
    singularName: 'type-piece';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    exigence: Schema.Attribute.Enumeration<
      ['obligatoire', 'si_applicable', 'si_disponible']
    > &
      Schema.Attribute.Required;
    groupe: Schema.Attribute.Enumeration<
      ['administratif', 'financier', 'technique']
    > &
      Schema.Attribute.Required;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::type-piece.type-piece'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTypeRapportTypeRapport extends Struct.CollectionTypeSchema {
  collectionName: 'types_rapport';
  info: {
    displayName: 'Type rapport';
    pluralName: 'types-rapport';
    singularName: 'type-rapport';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    libelle: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::type-rapport.type-rapport'
    > &
      Schema.Attribute.Private;
    ordre: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiValueChainValueChain extends Struct.CollectionTypeSchema {
  collectionName: 'value_chains';
  info: {
    displayName: 'Value Chain';
    pluralName: 'value-chains';
    singularName: 'value-chain';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    fullContent: Schema.Attribute.Blocks;
    heroImage: Schema.Attribute.Media<'images'>;
    isFeaturedHome: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::value-chain.value-chain'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    photoHint: Schema.Attribute.Text;
    priorityOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    shortIntro: Schema.Attribute.Text & Schema.Attribute.Required;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    emailChangeToken: Schema.Attribute.String & Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    orgName: Schema.Attribute.String;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    pendingEmail: Schema.Attribute.String & Schema.Attribute.Private;
    phone: Schema.Attribute.String;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::about-page.about-page': ApiAboutPageAboutPage;
      'api::appel.appel': ApiAppelAppel;
      'api::application.application': ApiApplicationApplication;
      'api::call-for-proposal.call-for-proposal': ApiCallForProposalCallForProposal;
      'api::candidature-guide.candidature-guide': ApiCandidatureGuideCandidatureGuide;
      'api::candidature.candidature': ApiCandidatureCandidature;
      'api::commune.commune': ApiCommuneCommune;
      'api::complaint-recourse.complaint-recourse': ApiComplaintRecourseComplaintRecourse;
      'api::complement.complement': ApiComplementComplement;
      'api::condition-prealable.condition-prealable': ApiConditionPrealableConditionPrealable;
      'api::contenu-aide.contenu-aide': ApiContenuAideContenuAide;
      'api::demande-decaissement.demande-decaissement': ApiDemandeDecaissementDemandeDecaissement;
      'api::document-contractuel.document-contractuel': ApiDocumentContractuelDocumentContractuel;
      'api::document-telechargeable.document-telechargeable': ApiDocumentTelechargeableDocumentTelechargeable;
      'api::etape-contractuelle.etape-contractuelle': ApiEtapeContractuelleEtapeContractuelle;
      'api::etape-programme.etape-programme': ApiEtapeProgrammeEtapeProgramme;
      'api::event.event': ApiEventEvent;
      'api::faq-entree.faq-entree': ApiFaqEntreeFaqEntree;
      'api::faq-item.faq-item': ApiFaqItemFaqItem;
      'api::faq.faq': ApiFaqFaq;
      'api::filiere.filiere': ApiFiliereFiliere;
      'api::footer-link.footer-link': ApiFooterLinkFooterLink;
      'api::homepage.homepage': ApiHomepageHomepage;
      'api::infrastructure-band.infrastructure-band': ApiInfrastructureBandInfrastructureBand;
      'api::infrastructure-type.infrastructure-type': ApiInfrastructureTypeInfrastructureType;
      'api::jalon-projet.jalon-projet': ApiJalonProjetJalonProjet;
      'api::mesure-corrective.mesure-corrective': ApiMesureCorrectiveMesureCorrective;
      'api::modalite-decaissement.modalite-decaissement': ApiModaliteDecaissementModaliteDecaissement;
      'api::news.news': ApiNewsNews;
      'api::notification-ami.notification-ami': ApiNotificationAmiNotificationAmi;
      'api::notification.notification': ApiNotificationNotification;
      'api::organisation.organisation': ApiOrganisationOrganisation;
      'api::partner.partner': ApiPartnerPartner;
      'api::province.province': ApiProvinceProvince;
      'api::rapport-requis.rapport-requis': ApiRapportRequisRapportRequis;
      'api::resource-document.resource-document': ApiResourceDocumentResourceDocument;
      'api::site-navigation.site-navigation': ApiSiteNavigationSiteNavigation;
      'api::statut-candidature.statut-candidature': ApiStatutCandidatureStatutCandidature;
      'api::statut-demande.statut-demande': ApiStatutDemandeStatutDemande;
      'api::statut-juridique.statut-juridique': ApiStatutJuridiqueStatutJuridique;
      'api::subvention.subvention': ApiSubventionSubvention;
      'api::success-story.success-story': ApiSuccessStorySuccessStory;
      'api::support-ticket.support-ticket': ApiSupportTicketSupportTicket;
      'api::type-contrepartie.type-contrepartie': ApiTypeContrepartieTypeContrepartie;
      'api::type-piece.type-piece': ApiTypePieceTypePiece;
      'api::type-rapport.type-rapport': ApiTypeRapportTypeRapport;
      'api::value-chain.value-chain': ApiValueChainValueChain;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}
