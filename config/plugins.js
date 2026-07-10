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
