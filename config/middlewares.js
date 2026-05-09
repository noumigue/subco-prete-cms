const normalizeOrigin = (value) => {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
};

module.exports = ({ env }) => {
  const corsOrigins = env.array('CORS_ORIGINS', [
    "https://prete-suco-portal.onrender.com",
    "http://localhost:3000"
  ]);

  const spacesOrigins = [
    env('DO_SPACES_BASE_URL'),
    env('DO_SPACES_CDN_URL'),
    env('DO_SPACES_BUCKET') && env('DO_SPACES_REGION')
      ? `https://${env('DO_SPACES_BUCKET')}.${env('DO_SPACES_REGION')}.digitaloceanspaces.com`
      : null,
    env('DO_SPACES_REGION') ? `https://${env('DO_SPACES_REGION')}.digitaloceanspaces.com` : null,
  ].map(normalizeOrigin).filter(Boolean);

  return [
    "strapi::logger",
    "strapi::errors",
    {
      name: "strapi::security",
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            "connect-src": ["'self'", "https:"],
            "img-src": ["'self'", "data:", "blob:", "market-assets.strapi.io", ...spacesOrigins],
            "media-src": ["'self'", "data:", "blob:", ...spacesOrigins],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: "strapi::cors",
      config: {
        origin: corsOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        headers: ["Content-Type", "Authorization", "Origin", "Accept"],
        keepHeaderOnError: true
      }
    },
    {
      name: "strapi::body",
      config: {
        formLimit: "10mb",
        jsonLimit: "10mb",
        textLimit: "10mb",
        formidable: {
          maxFileSize: 10 * 1024 * 1024
        }
      }
    },
    "strapi::poweredBy",
    "strapi::query",
    "strapi::session",
    "strapi::favicon",
    "strapi::public"
  ];
};
