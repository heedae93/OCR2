/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API 주소는 src/lib/api.ts + .env.local 의 NEXT_PUBLIC_API_URL 로만 결정합니다.
  // 여기서 기본값을 넣으면 빌드 시 고정되어 잘못된 포트(예: 5015)로 요청이 갈 수 있습니다.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }

    return config
  },
}

module.exports = nextConfig
