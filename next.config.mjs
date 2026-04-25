import { execSync } from "node:child_process";

function gitShortSha() {
  // VERCEL_GIT_COMMIT_SHA is set on Vercel; locally we shell out to git.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short=7 HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

const BUILD_ID = gitShortSha();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Surface the deployed commit to the client so the user can verify
  // exactly which build their browser is on (very useful for debugging
  // CDN / browser cache staleness).
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        child_process: false,
        worker_threads: false,
        module: false,
      };
    }
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
  async headers() {
    return [
      // .wasm files keep their long cache (their URL contains a content
      // hash, so a new build emits new URLs).
      {
        source: "/:all*.wasm",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // The HTML document for / must NOT be cached, otherwise the
      // browser keeps loading old chunk URLs from a stale render.
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
