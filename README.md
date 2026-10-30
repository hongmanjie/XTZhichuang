# 兴图智创视频创作平台

项目由 React/Vite 前端和 Node.js/Express 后端组成，使用 SQLite 持久化任务与业务数据。视频、图像和语音功能需要单独配置模型网关及相关服务。

当前功能和未完成事项请分别查阅 [实施记录与 Linux 部署说明](docs/07_实施记录与Linux部署说明.md) 和 [未完成事项与真实验收台账](docs/08_未完成事项与真实验收台账.md)。部分页面或操作尚未接入真实服务，不应视作全部完成。

## 本机开发

1. 安装 Node.js、npm，并分别在 `server` 和 `client` 目录运行 `npm ci`。
2. 将 `server/.env.example` 复制为 `server/.env`，按本机环境配置独立的 JWT 密钥、模型网关地址和密钥；如需语音功能，还要配置 IndexTTS 地址。
3. 在 `server` 目录运行 `npm run dev`，在 `client` 目录运行 `npm run dev`，通过前端开发服务器访问平台。
4. 全新数据库没有默认用户；需要使用 `server/src/bootstrap-admin.js` 初始化管理员，具体说明见实施记录。不要在有业务数据的数据库上运行演示数据脚本 `seed.js`。

前端生产构建使用 `cd client && npm run build`，后端测试使用 `cd server && npm test`。本机运行记录、数据库、上传素材和环境密钥均不在源码仓库内，需要在新环境单独配置或迁移。

## Linux 部署(192.168.86.107)

服务器使用 Docker Compose 部署,目录 `/data_ssd/xtzc`,访问地址 `http://192.168.86.107:3010/xtzc/`(子路径访问,也兼容根路径直连)。容器以挂载方式运行:

| 服务器目录 | 容器内路径 | 内容 |
|---|---|---|
| `data/` | `/app/server/data` | SQLite 数据库 |
| `uploads/` | `/app/server/uploads` | 上传素材 |
| `server-src/` | `/app/server/src` | 服务端源码(挂载更新) |
| `client-dist/` | `/app/client/dist` | 前端构建产物(挂载更新) |

环境变量在目录下 `.env` 与 compose 中配置:`MODELGATE_BASE`(模型网关地址,需保留 `/xt-platform/models/v1` 路径)、`APP_BASE_PATH=/xtzc`(子路径)、`JWT_SECRET`、`MODELGATE_API_KEY`、`INDEX_TTS_BASE_URL`。修改环境变量后需 `docker compose up -d` 重建容器(`restart` 不会重读环境变量)。

## 更新部署(日常)

代码更新不需要重建镜像,在仓库根目录执行:

```bash
npm run deploy:107
```

脚本自动完成:前端构建(含 `/xtzc/` 子路径)→ 打包 `server-src` 与 `client-dist`(自动排除约 200MB 静态样例图,更新包约 1MB)→ scp 传输 → 远端 `update.sh` 解包、重启并健康检查。过程中需输入一次 .107 的 SSH 密码,配置 SSH 公钥后免密。

仅当依赖变化(`package.json`、`requirements-cutout.txt`、`Dockerfile`)时才需要重建镜像并重新导出导入;更新流程与首次部署、数据迁移的完整说明见实施记录与 Linux 部署说明。不要将开发环境直接对外开放,上线前按未完成事项台账完成验收。

## 独立 Linux 开发和测试环境

`docker-compose.dev.yml` 使用独立的 Compose 项目、数据库、上传卷和 Elasticsearch；默认只绑定本机 3011 端口。它需要事先构建 `xtzc-dev-base:local` 镜像，并在宿主机编译前端：

```bash
cd client && npm ci && npm run build:xtzc
cd ..
docker build -t xtzc-dev-base:local .
cp docker-dev.env.example .env.dev
# 根据环境填写 .env.dev 中的网关地址、密钥和独立 JWT_SECRET
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d
```

仅在可信内网需要其他机器访问时，显式设置 `DEV_BIND_HOST`。首次使用空数据库时，可通过 `BOOTSTRAP_ADMIN_ACCOUNT` 和至少 12 字符的 `BOOTSTRAP_ADMIN_PASSWORD` 运行 `server/src/bootstrap-admin.js` 创建管理员；不要把真实配置、数据库或测试媒体提交到仓库。开发容器挂载本目录的 `server/src` 和构建后的 `client/dist`，修改后需要重启应用；前端修改还需要重新构建。

`tools/deploy-107.mjs` 是旧线上环境的更新脚本，独立测试环境不要使用该脚本。
