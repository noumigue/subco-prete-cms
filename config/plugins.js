module.exports = ({ env }) => {
  // Champs additionnels persistes par l'endpoint /auth/local/register.
  // orgName : nom d'organisation saisi a l'inscription (alimente la session, jamais de repli sur l'e-mail).
  // phone   : capte a la 1re candidature (D1), remonte au compte.
  const config = {
    'users-permissions': {
      config: {
        register: {
          allowedFields: ['orgName', 'phone'],
        },
      },
    },
  };

  // ---------------------------------------------------------------------------
  // FILET DE SECURITE e-mail natif (facultatif) — la gouvernance des e-mails
  // metier/auth passe par la mail platform (src/utils/mail + api/portal-auth),
  // qui utilise directement nodemailer via les SMTP_*. Mais le panneau ADMIN
  // Strapi (reset mot de passe d'un admin) utilise, lui, le plugin `email`.
  // Si le provider nodemailer est installe ET le SMTP configure, on le branche
  // pour couvrir ce cas — sinon on ne touche a rien (pas de crash au boot).
  // ---------------------------------------------------------------------------
  const smtpHost = env('SMTP_HOST');
  const smtpUser = env('SMTP_USER');
  const smtpPass = env('SMTP_PASS');
  if (smtpHost && smtpUser && smtpPass) {
    let nodemailerProviderAvailable = false;
    try {
      require.resolve('@strapi/provider-email-nodemailer');
      nodemailerProviderAvailable = true;
    } catch {
      nodemailerProviderAvailable = false;
    }

    if (nodemailerProviderAvailable) {
      const smtpPort = env.int('SMTP_PORT', 587);
      config.email = {
        config: {
          provider: 'nodemailer',
          providerOptions: {
            host: smtpHost,
            port: smtpPort,
            secure: env.bool('SMTP_SECURE', smtpPort === 465),
            auth: { user: smtpUser, pass: smtpPass },
          },
          settings: {
            defaultFrom: env('NOTIFICATION_FROM_EMAIL', smtpUser),
            defaultReplyTo: env('NOTIFICATION_FROM_EMAIL', smtpUser),
          },
        },
      };
    }
  }

  if (env.bool('STRAPI_DISABLE_UPLOAD_PROVIDER', false)) {
    return config;
  }

  const bucket = env('DO_SPACES_BUCKET');
  const region = env('DO_SPACES_REGION');
  const accessKeyId = env('DO_SPACES_KEY');
  const secretAccessKey = env('DO_SPACES_SECRET');

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return config;
  }

  const endpoint = env('DO_SPACES_ENDPOINT', `https://${region}.digitaloceanspaces.com`);
  const baseUrl = env('DO_SPACES_BASE_URL', `https://${bucket}.${region}.digitaloceanspaces.com`);

  return {
    ...config,
    upload: {
      config: {
        provider: 'aws-s3',
        providerOptions: {
          baseUrl,
          rootPath: env('DO_SPACES_ROOT_PATH', 'uploads'),
          s3Options: {
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
            region,
            endpoint,
            forcePathStyle: env.bool('DO_SPACES_FORCE_PATH_STYLE', false),
            params: {
              ACL: env('DO_SPACES_ACL', 'public-read'),
              Bucket: bucket,
            },
          },
        },
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
      },
    },
  };
};
