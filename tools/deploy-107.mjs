#!/usr/bin/env node
/**
 * 一键更新 .107 部署(挂载模式,无需重建镜像)
 *
 * 用法(仓库根目录):
 *   npm run deploy:107            # 构建 + 打包 + 传输 + 远端生效
 *   npm run deploy:107 -- --dry-run   # 只构建打包,不传输(打印手工命令)
 *
 * 流程:tsc+ vite 构建(自动带 /xtzc/ 子路径)→ 打包 server-src/client-dist
 *      → scp 到 .107:/tmp/update-pkg.tgz → 执行远端 update.sh(解包+重启+健康检查)
 *
 * 传输需要输入一次 .107 的 SSH 密码;配置 SSH 公钥后免密(见脚本底部说明)。
 * 仅当依赖变化(package.json / requirements-cutout.txt / Dockerfile)时才需要重建镜像。
 */
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const HOST = process.env.DEPLOY_HOST || '192.168.86.107'
const USER = process.env.DEPLOY_USER || 'xtxk'
const REMOTE_DIR = process.env.DEPLOY_DIR || '/data_ssd/xtzc'
const REMOTE_PKG = '/tmp/update-pkg.tgz'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:')), '..')
const CLIENT = path.join(ROOT, 'client')
const STAGING = path.join(ROOT, 'deploy-pkg')
const TARBALL = path.join(ROOT, 'update-pkg.tgz') // tar 在 staging 内执行,输出到上级(仓库根)
const TARBALL_REL = 'update-pkg.tgz'

const dryRun = process.argv.includes('--dry-run')
const step = (msg) => console.log('\n==> ' + msg)

function run(cmd, opts = {}) {
  console.log('  $ ' + cmd)
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function copyWithFilter(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (s === path.join(CLIENT, 'dist', 'images')) continue // 201MB 静态样例图不随包更新
      copyWithFilter(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

try {
  step('1/5 构建前端(tsc + vite,子路径 /xtzc/)')
  run('npm run build:xtzc', { cwd: CLIENT })

  step('2/5 组装更新包(server-src + client-dist,扁平布局)')
  fs.rmSync(STAGING, { recursive: true, force: true })
  copyWithFilter(path.join(ROOT, 'server', 'src'), path.join(STAGING, 'server-src'))
  copyWithFilter(path.join(CLIENT, 'dist'), path.join(STAGING, 'client-dist'))

  step('3/5 打 tar 包')
  fs.rmSync(TARBALL, { force: true })
  run('tar -czf ../update-pkg.tgz .', { cwd: STAGING })
  const size = (fs.statSync(TARBALL).size / 1024 / 1024).toFixed(2)
  const md5 = crypto.createHash('md5').update(fs.readFileSync(TARBALL)).digest('hex')
  console.log(`  包: ${TARBALL} (${size} MB, md5 ${md5})`)

  const scpCmd = `scp "${TARBALL_REL}" ${USER}@${HOST}:/tmp/update-pkg.tgz`
  const sshCmd = `ssh ${USER}@${HOST} "bash ${REMOTE_DIR}/update.sh"`

  if (dryRun) {
    step('DRY-RUN:跳过传输。手工执行以下命令完成更新:')
    console.log('  ' + scpCmd)
    console.log('  ' + sshCmd)
    process.exit(0)
  }

  step('4/5 传输到 .107(输入 SSH 密码)')
  run(scpCmd)

  step('5/5 远端解包 + 重启 + 健康检查')
  run(sshCmd)

  console.log('\n✅ 更新完成: http://192.168.86.107:3010/xtzc/')
  console.log('   (免密建议: type %USERPROFILE%\\.ssh\\id_ed25519.pub | ssh ' + USER + '@' + HOST + ' "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys")')
} catch (e) {
  console.error('\n❌ 部署失败: ' + (e.message || e))
  process.exit(1)
}
