/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API 주소는 src/lib/api.ts + .env.local 의 NEXT_PUBLIC_API_URL 로만 결정합니다.
  // 여기서 기본값을 넣으면 빌드 시 고정되어 잘못된 포트(예: 5015)로 요청이 갈 수 있습니다.
  webpack: (config, { dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }

    // Windows: 네이티브 파일 감시 + HMR이 .next 청크를 동시에 건드리며 UNKNOWN(-4094) 잠금이 나는 경우가 있어
    // 폴링으로 완화 (개발만, 약간의 CPU 사용 증가).
    if (dev && process.platform === 'win32') {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 2000,
        aggregateTimeout: 600,
      }
    }

    return config
  },
}

module.exports = nextConfig
