module.exports = ({ env }) => {
  const bucket = env('DO_SPACES_BUCKET');
  const region = env('DO_SPACES_REGION');
  const accessKeyId = env('DO_SPACES_KEY');
  const secretAccessKey = env('DO_SPACES_SECRET');

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return {};
  }

  const endpoint = env('DO_SPACES_ENDPOINT', `https://${region}.digitaloceanspaces.com`);
  const baseUrl = env('DO_SPACES_BASE_URL', `https://${bucket}.${region}.digitaloceanspaces.com`);

  return {
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
