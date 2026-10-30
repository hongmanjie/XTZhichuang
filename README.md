# 兴图智创视频创作平台

项目由 React/Vite 前端和 Node.js/Express 后端组成，使用 SQLite 持久化任务与业务数据。视频、图像和语音功能需要单独配置模型网关及相关服务。

当前功能和未完成事项请分别查阅 [实施记录与 Linux 部署说明](docs/07_实施记录与Linux部署说明.md) 和 [未完成事项与真实验收台账](docs/08_未完成事项与真实验收台账.md)。部分页面或操作尚未接入真实服务，不应视作全部完成。

## 本机开发

1. 安装 Node.js、npm，并分别在 `server` 和 `client` 目录运行 `npm ci`。
2. 将 `server/.env.example` 复制为 `server/.env`，按本机环境配置独立的 JWT 密钥、模型网关地址和密钥；如需语音功能，还要配置 IndexTTS 地址。
3. 在 `server` 目录运行 `npm run dev`，在 `client` 目录运行 `npm run dev`，通过前端开发服务器访问平台。
4. 全新数据库没有默认用户；需要使用 `server/src/bootstrap-admin.js` 初始化管理员，具体说明见实施记录。不要在有业务数据的数据库上运行演示数据脚本 `seed.js`。

前端生产构建使用 `cd client && npm run build`，后端测试使用 `cd server && npm test`。本机运行记录、数据库、上传素材和环境密钥均不在源码仓库内，需要在新环境单独配置或迁移。

## Linux 部署

仓库包含 Dockerfile 和 Compose 配置，但镜像尚未在 Linux 上构建和验收。部署、数据迁移及上线前的检查请先阅读实施记录，不要直接将开发环境对外开放。
