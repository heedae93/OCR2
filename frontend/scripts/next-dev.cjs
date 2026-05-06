/**
 * Windows에서 .next 캐시가 잠기거나 손상되면 Next가 청크 파일을 열지 못해
 * Internal Server Error(UNKNOWN -4094 등)가 반복될 수 있어, win32에서는
 * dev 시작 시 .next를 지운 뒤 서버를 띄운다.
 * 캐시 유지: SKIP_NEXT_CACHE_CLEAN=1 npm run dev
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const frontendRoot = path.join(__dirname, '..')
const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next')

if (!fs.existsSync(nextBin)) {
  console.error('[bbocr] next not found. Run: npm install')
  process.exit(1)
}

if (os.platform() === 'win32' && process.env.SKIP_NEXT_CACHE_CLEAN !== '1') {
  const nextDir = path.join(frontendRoot, '.next')
  try {
    if (fs.existsSync(nextDir)) {
      fs.rmSync(nextDir, { recursive: true, force: true })
      console.info('[bbocr] Cleared frontend/.next (Windows). Set SKIP_NEXT_CACHE_CLEAN=1 to skip.')
    }
  } catch (err) {
    console.warn('[bbocr] Could not remove .next:', err.message)
  }
}

const env = { ...process.env }
if (os.platform() === 'win32') {
  // webpack watchpack: 네이티브 watcher 대신 폴링( next.config.js 의 watchOptions 와 함께 사용 )
  if (env.WATCHPACK_POLLING !== '0') {
    env.WATCHPACK_POLLING = env.WATCHPACK_POLLING || 'true'
  }
}

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '6017', '-H', '0.0.0.0'], {
  cwd: frontendRoot,
  stdio: 'inherit',
  env,
  windowsHide: true,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
