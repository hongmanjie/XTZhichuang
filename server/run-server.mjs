/**
 * 服务守护启动器：以 detached 子进程启动服务端，主进程退出后服务继续运行。
 * 日志文件以同步方式打开，fd 直接作为子进程 stdio，
 * 子进程直接写文件、不依赖父进程存活（规避管道断裂/EPIPE 问题）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname // server/ 目录，node_modules 与 src 均在此
const LOG = path.join(ROOT, 'server.log')

const logFd = fs.openSync(LOG, 'a')
fs.writeSync(logFd, `\n===== [runner] ${new Date().toISOString()} 启动服务端 =====\n`)

const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: process.env,
})

child.on('error', (e) => fs.writeSync(logFd, `[runner] ${new Date().toISOString()} 启动失败 ${e.message}\n`))
child.unref()
fs.writeSync(logFd, `[runner] ${new Date().toISOString()} 已托管 pid=${child.pid}\n`)
process.exit(0)
