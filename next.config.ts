import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Our request config lives in lib/i18n/, not the plugin's default ./i18n/.
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // People type /login. Send them to the real page instead of a 404.
  async redirects() {
    return [
      { source: "/:locale(en|ar)/(login|log-in|signin)", destination: "/:locale/sign-in", permanent: false },
      { source: "/(login|log-in|signin|sign-in)", destination: "/en/sign-in", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
