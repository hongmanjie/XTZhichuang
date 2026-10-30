# 兴图智创 商家后台 · API 接口全量清单

> 生成方式：从 `server/src/routes/*.js` 源码静态解析 + 运行时探测
> 端点总数：**225**（GET 135 / POST 90）
> 挂载前缀：所有路由统一挂在 `/api` 下（`server/src/index.js:44-58`）
> 鉴权：`authRequired` **220** 个 · `adminRequired` 追加 **10** 个 · 免鉴权 **5** 个

## 鉴权说明

| 中间件 | 位置 | 行为 |
|--------|------|------|
| `authRequired` | `middleware/auth.js:23` | 从 `Authorization: Bearer` / `headers.token` / `query.token` 三处取 JWT；校验后回查 `users` 表并判断 `status===1`，把用户行挂到 `req.user` |
| `adminRequired` | `middleware/auth.js:39` | 要求 `req.user.role_id` 为 1（超管）或 2（管理员），否则 403 |

**统一响应格式**：`{ code: 0, data, message }`，分页用 `page(list, total, pageNum, pageSize)` 返回 `{ code:0, data:{ list, total, pageNum, pageSize } }`。
业务失败 `code` 为 400/404，HTTP 状态码始终 200（除 401/403 与 500）。

---

## 创意工具集 · `creative.js`（36 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/highlight/editing/init` | 🔑 登录 | ✅ 正常 5ms |
| 2 | GET | `/highlight/editing/task/list` | 🔑 登录 | ✅ 正常 18ms |
| 3 | GET | `/highlight/editing/task/overview` | 🔑 登录 | ✅ 正常 7ms |
| 4 | POST | `/highlight/editing/task/create` | 🔑 登录 | ✅ 正常 6ms |
| 5 | GET | `/highlight/editing/clip/list` | 🔑 登录 | ✅ 正常 5ms |
| 6 | GET | `/highlight/editing/clip/detail` | 🔑 登录 | ✅ 正常 6ms |
| 7 | POST | `/highlight/editing/clip/title/update` | 🔑 登录 | ✅ 正常 5ms |
| 8 | POST | `/highlight/editing/clip/publish` | 🔑 登录 | ✅ 正常 5ms |
| 9 | POST | `/highlight/editing/clip/save/material` | 🔑 登录 | ✅ 正常 3ms |
| 10 | POST | `/highlight/editing/live/stop` | 🔑 登录 | ✅ 正常 4ms |
| 11 | POST | `/highlight/editing/share/parse` | 🔑 登录 | ✅ 正常 5ms |
| 12 | GET | `/three/second/category/list` | 🔑 登录 | ✅ 正常 4ms |
| 13 | GET | `/three/second/demo/list` | 🔑 登录 | ✅ 正常 4ms |
| 14 | POST | `/three/second/make/video` | 🔑 登录 | ✅ 正常 5ms |
| 15 | GET | `/three/second/service/health` | 🔑 登录 | ✅ 正常 5ms |
| 16 | GET | `/super/resolution/init/info/new` | 🔑 登录 | ✅ 正常 8ms |
| 17 | POST | `/super/resolution/create/new` | 🔑 登录 | ✅ 正常 6ms |
| 18 | GET | `/super/resolution/task/list` | 🔑 登录 | ✅ 正常 4ms |
| 19 | POST | `/video/scene/analysis/submit` | 🔑 登录 | ✅ 正常 7ms |
| 20 | GET | `/video/scene/analysis/list` | 🔑 登录 | ✅ 正常 5ms |
| 21 | POST | `/video/scene/analysis/retry` | 🔑 登录 | ✅ 正常 6ms |
| 22 | POST | `/video/scene/analysis/delete` | 🔑 登录 | ✅ 正常 4ms |
| 23 | GET | `/video/scene/analysis/tryout/status` | 🔑 登录 | ✅ 正常 4ms |
| 24 | POST | `/tools/erase/submit` | 🔑 登录 | ✅ 正常 5ms |
| 25 | GET | `/tools/erase/task/list` | 🔑 登录 | ✅ 正常 6ms |
| 26 | GET | `/music/category/list` | 🔑 登录 | ✅ 正常 4ms |
| 27 | GET | `/music/list/info` | 🔑 登录 | ✅ 正常 7ms |
| 28 | GET | `/music/list/by/category` | 🔑 登录 | ✅ 正常 5ms |
| 29 | POST | `/music/upload/info` | 🔑 登录 | ✅ 正常 7ms |
| 30 | GET | `/subtitle/material/init/info` | 🔑 登录 | ✅ 正常 2ms |
| 31 | GET | `/data/compass/video/init/config` | 🔑 登录 | ✅ 正常 5ms |
| 32 | GET | `/data/compass/video/list/info` | 🔑 登录 | ✅ 正常 7ms |
| 33 | POST | `/data/compass/video/query/url` | 🔑 登录 | ✅ 正常 5ms |
| 34 | POST | `/data/compass/video/analysis` | 🔑 登录 | ✅ 正常 4ms |
| 35 | GET | `/video/montage/feedback/init` | 🔑 登录 | ✅ 正常 5ms |
| 36 | POST | `/video/montage/feedback/submit` | 🔑 登录 | ✅ 正常 5ms |

## 会员/脚本海/提现/数字人/商拍 · `biz.js`（31 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/member/order/page/init` | 🔑 登录 | ✅ 正常 5ms |
| 2 | POST | `/member/order/create/order` | 🔑 登录 | ✅ 正常 9ms |
| 3 | GET | `/member/order/list/info` | 🔑 登录 | ✅ 正常 4ms |
| 4 | GET | `/member/order/order/status` | 🔑 登录 | ✅ 正常 4ms |
| 5 | GET | `/script/sea/info/list` | 🔑 登录 | ✅ 正常 6ms |
| 6 | GET | `/script/sea/detail/info` | 🔑 登录 | ✅ 正常 5ms |
| 7 | POST | `/script/sea/claim/submit` | 🔑 登录 | ✅ 正常 6ms |
| 8 | GET | `/my/project/script/init` | 🔑 登录 | ✅ 正常 7ms |
| 9 | GET | `/my/project/team/item` | 🔑 登录 | ✅ 正常 5ms |
| 10 | POST | `/my/project/add/script/new` | 🔑 登录 | ✅ 正常 4ms |
| 11 | POST | `/my/project/delete/script` | 🔑 登录 | ✅ 正常 5ms |
| 12 | POST | `/my/project/edit/script/name` | 🔑 登录 | ✅ 正常 7ms |
| 13 | GET | `/withdraw/init` | 🔑 登录 | ✅ 正常 3ms |
| 14 | GET | `/withdraw/page/init` | 🔑 登录 | ✅ 正常 5ms |
| 15 | POST | `/withdraw/submit` | 🔑 登录 | ✅ 正常 8ms |
| 16 | GET | `/withdraw/withdrawal/log` | 🔑 登录 | ✅ 正常 3ms |
| 17 | POST | `/withdraw/invite/friend` | 🔑 登录 | ✅ 正常 5ms |
| 18 | GET | `/withdraw/friend/recharge` | 🔑 登录 | ✅ 正常 4ms |
| 19 | POST | `/withdraw/add/binding/info` | 🔑 登录 | ✅ 正常 10ms |
| 20 | GET | `/ip/avatar/filter/List` | 🔑 登录 | ✅ 正常 8ms |
| 21 | GET | `/ip/avatar/industry/list` | 🔑 登录 | ✅ 正常 4ms |
| 22 | GET | `/ip/avatar/person/init/info` | 🔑 登录 | ✅ 正常 6ms |
| 23 | GET | `/ip/avatar/background/list` | 🔑 登录 | ✅ 正常 5ms |
| 24 | GET | `/ip/avatar/voice/list` | 🔑 登录 | ✅ 正常 5ms |
| 25 | GET | `/ai/commerce/photo/template/list/v2` | 🔑 登录 | ✅ 正常 7ms |
| 26 | GET | `/ai/commerce/photo/template/generate/category/create` | 🔑 登录 | ✅ 正常 5ms |
| 27 | GET | `/ai/commerce/photo/template/generate/direction/list` | 🔑 登录 | ✅ 正常 5ms |
| 28 | GET | `/ai/commerce/photo/demo/list` | 🔑 登录 | ✅ 正常 3ms |
| 29 | GET | `/ai/commerce/photo/initInfo` | 🔑 登录 | ✅ 正常 5ms |
| 30 | GET | `/case/course/category/list` | 🔑 登录 | ✅ 正常 5ms |
| 31 | GET | `/case/course/demo/list` | 🔑 登录 | ✅ 正常 5ms |

## 工作台与数据看板 · `workbench.js`（25 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/workbench/data/init/new` | 🔑 登录 | ✅ 正常 3ms |
| 2 | GET | `/data/board/config/init` | 🔑 登录 | ✅ 正常 4ms |
| 3 | GET | `/data/board/config/briefing` | 🔑 登录 | ✅ 正常 4ms |
| 4 | GET | `/data/board/config/trend` | 🔑 登录 | ✅ 正常 3ms |
| 5 | GET | `/data/board/config/core` | 🔑 登录 | ✅ 正常 4ms |
| 6 | GET | `/data/board/config/ranking` | 🔑 登录 | ✅ 正常 5ms |
| 7 | GET | `/data/board/config/target` | 🔑 登录 | ✅ 正常 4ms |
| 8 | GET | `/data/board/config/excellent/works` | 🔑 登录 | ✅ 正常 3ms |
| 9 | GET | `/data/board/config/function` | 🔑 登录 | ✅ 正常 3ms |
| 10 | GET | `/new/user/reward/task/list` | 🔑 登录 | ✅ 正常 4ms |
| 11 | GET | `/new/user/reward/is/show/guide` | 🔑 登录 | ✅ 正常 3ms |
| 12 | POST | `/new/user/reward/claim` | 🔑 登录 | ✅ 正常 5ms |
| 13 | GET | `/message/center/list/info` | 🔑 登录 | ✅ 正常 6ms |
| 14 | GET | `/message/center/unread/message` | 🔑 登录 | ✅ 正常 4ms |
| 15 | POST | `/message/center/message/batch` | 🔑 登录 | ✅ 正常 8ms |
| 16 | GET | `/message/center/query/body` | 🔑 登录 | ✅ 正常 5ms |
| 17 | GET | `/task/center/unread/count` | 🔑 登录 | ✅ 正常 4ms |
| 18 | GET | `/task/center/upload/page` | 🔑 登录 | ✅ 正常 3ms |
| 19 | POST | `/task/center/upload/bind` | 🔑 登录 | ✅ 正常 6ms |
| 20 | POST | `/behavior/report` | 🔑 登录 | ✅ 正常 5ms |
| 21 | GET | `/account/top/message` | 🔑 登录 | ✅ 正常 2ms |
| 22 | GET | `/account/version/notice` | 🔑 登录 | ✅ 正常 4ms |
| 23 | GET | `/account/version/notice/list` | 🔑 登录 | ✅ 正常 4ms |
| 24 | GET | `/account/feature/status/list` | 🔑 登录 | ✅ 正常 4ms |
| 25 | GET | `/activity/popup/get` | 🔑 登录 | ✅ 正常 4ms |

## AI 创作任务 · `create.js`（18 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/create/modules` | 🔑 登录 | ✅ 正常 5ms |
| 2 | GET | `/create/module/:module/config` | 🔑 登录 | ✅ 正常 5ms |
| 3 | POST | `/create/replica` | 🔑 登录 | ✅ 正常 4ms |
| 4 | POST | `/create/factory` | 🔑 登录 | ✅ 正常 5ms |
| 5 | POST | `/create/studio` | 🔑 登录 | ✅ 正常 8ms |
| 6 | POST | `/create/materialField` | 🔑 登录 | ✅ 正常 7ms |
| 7 | POST | `/create/analysis` | 🔑 登录 | ✅ 正常 5ms |
| 8 | POST | `/create/human` | 🔑 登录 | ✅ 正常 3ms |
| 9 | GET | `/task/list` | 🔑 登录 | ✅ 正常 9ms |
| 10 | GET | `/task/detail` | 🔑 登录 | ✅ 正常 6ms |
| 11 | POST | `/task/retry` | 🔑 登录 | ✅ 正常 6ms |
| 12 | POST | `/task/cancel` | 🔑 登录 | ✅ 正常 5ms |
| 13 | POST | `/task/delete` | 🔑 登录 | ✅ 正常 6ms |
| 14 | GET | `/digital_human/list` | 🔑 登录 | ✅ 正常 4ms |
| 15 | GET | `/digital_human/voices` | 🔑 登录 | ✅ 正常 5ms |
| 16 | GET | `/ai/commerce/photo/category/list` | 🔑 登录 | ✅ 正常 4ms |
| 17 | POST | `/ai/factory/prompt/optimize` | 🔑 登录 | ✅ 正常 4ms |
| 18 | POST | `/ai/factory/generation/sceneDesc` | 🔑 登录 | ✅ 正常 636ms |

## 团队与组织 · `team.js`（18 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/department/list` | 🔐 管理员 | ✅ 正常 6ms |
| 2 | POST | `/department/save` | 🔐 管理员 | ✅ 正常 7ms |
| 3 | POST | `/department/delete` | 🔐 管理员 | ✅ 正常 4ms |
| 4 | GET | `/brand/list` | 🔑 登录 | ✅ 正常 6ms |
| 5 | POST | `/brand/save` | 🔑 登录 | ✅ 正常 6ms |
| 6 | POST | `/brand/delete` | 🔑 登录 | ✅ 正常 6ms |
| 7 | GET | `/team/member/list` | 🔑 登录 | ✅ 正常 4ms |
| 8 | POST | `/team/member/save` | 🔐 管理员 | ✅ 正常 5ms |
| 9 | POST | `/team/member/status` | 🔐 管理员 | ✅ 正常 3ms |
| 10 | POST | `/team/member/delete` | 🔐 管理员 | ✅ 正常 5ms |
| 11 | GET | `/role/list` | 🔑 登录 | ✅ 正常 3ms |
| 12 | POST | `/role/save` | 🔐 管理员 | ✅ 正常 5ms |
| 13 | POST | `/role/delete` | 🔐 管理员 | ✅ 正常 5ms |
| 14 | GET | `/role/authority/info` | 🔑 登录 | ✅ 正常 2ms |
| 15 | GET | `/user/group/list` | 🔑 登录 | ✅ 正常 4ms |
| 16 | GET | `/partner/info` | 🔑 登录 | ✅ 正常 4ms |
| 17 | GET | `/partner/withdrawal-records` | 🔑 登录 | ✅ 正常 3ms |
| 18 | GET | `/partner/withdraw/list` | 🔑 登录 | ✅ 正常 3ms |

## 素材资产库 · `material.js`（16 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/folder/list` | 🔑 登录 | ✅ 正常 5ms |
| 2 | POST | `/folder/save` | 🔑 登录 | ✅ 正常 2ms |
| 3 | POST | `/folder/delete` | 🔑 登录 | ✅ 正常 5ms |
| 4 | POST | `/material/upload` | 🔑 登录 | ✅ 正常 6ms |
| 5 | GET | `/material/list` | 🔑 登录 | ✅ 正常 5ms |
| 6 | GET | `/material/detail` | 🔑 登录 | ✅ 正常 5ms |
| 7 | POST | `/material/update` | 🔑 登录 | ✅ 正常 6ms |
| 8 | POST | `/material/delete` | 🔑 登录 | ✅ 正常 9ms |
| 9 | GET | `/material/categories` | 🔑 登录 | ✅ 正常 8ms |
| 10 | GET | `/asset/statistics` | 🔑 登录 | ✅ 正常 5ms |
| 11 | GET | `/script/list` | 🔑 登录 | ✅ 正常 6ms |
| 12 | GET | `/script/detail` | 🔑 登录 | ✅ 正常 5ms |
| 13 | POST | `/script/save` | 🔑 登录 | ✅ 正常 5ms |
| 14 | POST | `/script/delete` | 🔑 登录 | ✅ 正常 6ms |
| 15 | GET | `/work/list` | 🔑 登录 | ✅ 正常 7ms |
| 16 | POST | `/work/delete` | 🔑 登录 | ✅ 正常 5ms |

## 广告投放数据 · `ads.js`（15 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/ad/launch/advertiser/list` | 🔑 登录 | ✅ 正常 16ms |
| 2 | POST | `/ad/launch/advertiser/save` | 🔑 登录 | ✅ 正常 6ms |
| 3 | POST | `/ad/launch/advertiser/delete` | 🔑 登录 | ✅ 正常 8ms |
| 4 | GET | `/ad/launch/group/list` | 🔑 登录 | ✅ 正常 7ms |
| 5 | POST | `/ad/launch/group/save` | 🔑 登录 | ✅ 正常 7ms |
| 6 | POST | `/ad/launch/group/delete` | 🔑 登录 | ✅ 正常 6ms |
| 7 | GET | `/ad/launch/data/overview` | 🔑 登录 | ✅ 正常 9ms |
| 8 | GET | `/ad/launch/data/list` | 🔑 登录 | ✅ 正常 6ms |
| 9 | GET | `/ad/launch/data/detail` | 🔑 登录 | ✅ 正常 5ms |
| 10 | GET | `/ad/launch/page/init` | 🔑 登录 | ✅ 正常 4ms |
| 11 | GET | `/ad/launch/dropdown/init` | 🔑 登录 | ✅ 正常 5ms |
| 12 | GET | `/ad/launch/if/show` | 🔑 登录 | ✅ 正常 4ms |
| 13 | GET | `/ad/launch/video/manager/list` | 🔑 登录 | ✅ 正常 4ms |
| 14 | POST | `/ad/launch/video/manager/submit` | 🔑 登录 | ✅ 正常 9ms |
| 15 | POST | `/ad/launch/video/manager/batch/submit` | 🔑 登录 | ✅ 正常 8ms |

## 爆款创作 · `hot.js`（11 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/hot/list` | 🔑 登录 | ✅ 正常 3ms |
| 2 | GET | `/hot/detail` | 🔑 登录 | ✅ 正常 3ms |
| 3 | GET | `/hot/categories` | 🔑 登录 | ✅ 正常 3ms |
| 4 | GET | `/hot/platforms` | 🔑 登录 | ✅ 正常 4ms |
| 5 | POST | `/viral/replica/parseShareUrl` | 🔑 登录 | ✅ 正常 5ms |
| 6 | GET | `/viral-replica/v2/config/analysis-point` | 🔑 登录 | ✅ 正常 5ms |
| 7 | GET | `/viral-replica/v2/config/scene-image-point` | 🔑 登录 | ✅ 正常 4ms |
| 8 | GET | `/viral-replica/v2/config/video-models` | 🔑 登录 | ✅ 正常 3ms |
| 9 | GET | `/viral-replica/v2/scene-generations` | 🔑 登录 | ✅ 正常 3ms |
| 10 | GET | `/viral-replica/v2/tasks` | 🔑 登录 | ✅ 正常 5ms |
| 11 | POST | `/viral/replica/analysis/point` | 🔑 登录 | ✅ 正常 6ms |

## AI Agent 会话 · `agent.js`（10 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/skills` | 🔑 登录 | ✅ 正常 7ms |
| 2 | GET | `/skills/options` | 🔑 登录 | ✅ 正常 4ms |
| 3 | GET | `/conversations` | 🔑 登录 | ✅ 正常 7ms |
| 4 | POST | `/conversations` | 🔑 登录 | ✅ 正常 7ms |
| 5 | GET | `/conversations/:id/messages` | 🔑 登录 | ✅ 正常 6ms |
| 6 | POST | `/conversations/delete` | 🔑 登录 | ✅ 正常 8ms |
| 7 | GET | `/conversations/chat` | 🔑 登录 | ✅ 正常（SSE 专项测试） |
| 8 | POST | `/conversations/chat` | 🔑 登录 | ✅ 正常（SSE 专项测试） |
| 9 | GET | `/agent/generations` | 🔑 登录 | ✅ 正常 4ms |
| 10 | GET | `/artifacts` | 🔑 登录 | ✅ 正常 5ms |

## 认证与账号 · `auth.js`（10 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/login/init` | 🌐 公开 | ✅ 正常（T2 专项测试） |
| 2 | POST | `/login` | 🌐 公开 | ✅ 正常（T2 专项测试） |
| 3 | GET | `/user/info` | 🔑 登录 | ✅ 正常 4ms |
| 4 | POST | `/logout` | 🔑 登录 | ✅ 正常（T2 专项测试） |
| 5 | POST | `/user/password` | 🔑 登录 | ❌ 失败 22ms |
| 6 | GET | `/account/top/message` | 🔑 登录 | ✅ 正常 2ms |
| 7 | GET | `/account/version/notice` | 🔑 登录 | ✅ 正常 4ms |
| 8 | GET | `/account/feature/status/list` | 🔑 登录 | ✅ 正常 4ms |
| 9 | GET | `/activity/popup/get` | 🔑 登录 | ✅ 正常 4ms |
| 10 | POST | `/account/update/enterprise/name` | 🔑 登录 | ✅ 正常 4ms |

## 系统设置 · `setting.js`（10 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/setting/aiPoint/overview` | 🔑 登录 | ✅ 正常 7ms |
| 2 | POST | `/setting/aiPoint/grant` | 🔐 管理员 | ✅ 正常 6ms |
| 3 | GET | `/setting/consumption/list` | 🔑 登录 | ✅ 正常 6ms |
| 4 | GET | `/setting/log/list` | 🔐 管理员 | ✅ 正常 6ms |
| 5 | GET | `/user/user/setting` | 🔑 登录 | ✅ 正常 8ms |
| 6 | POST | `/user/edit/save` | 🔑 登录 | ✅ 正常 8ms |
| 7 | GET | `/user/edit/query` | 🔑 登录 | ✅ 正常 4ms |
| 8 | GET | `/user/list/info` | 🔑 登录 | ✅ 正常 5ms |
| 9 | POST | `/user/user/check` | 🔑 登录 | ✅ 正常 6ms |
| 10 | POST | `/account/bind/invitation/code` | 🔑 登录 | ✅ 正常 7ms |

## AI 脚本分镜 · `scriptDetail.js`（8 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/ai/script/subitem/list` | 🔑 登录 | ✅ 正常 8ms |
| 2 | POST | `/ai/script/subitem/edit` | 🔑 登录 | ✅ 正常 6ms |
| 3 | POST | `/ai/script/subitem/split/edit` | 🔑 登录 | ✅ 正常 5ms |
| 4 | POST | `/ai/script/subitem/structure/edit` | 🔑 登录 | ✅ 正常 9ms |
| 5 | POST | `/ai/script/intelligent/generation` | 🔑 登录 | ✅ 正常 8ms |
| 6 | POST | `/ai/script/polish` | 🔑 登录 | ✅ 正常 5ms |
| 7 | GET | `/ai/script/generation/record` | 🔑 登录 | ✅ 正常 8ms |
| 8 | POST | `/ai/script/dictate/script/generation` | 🔑 登录 | ✅ 正常 1969ms |

## 智能剪辑 · `aimix.js`（6 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/ai-mix/list` | 🔑 登录 | ✅ 正常 6ms |
| 2 | GET | `/ai-mix/detail` | 🔑 登录 | ✅ 正常 3ms |
| 3 | POST | `/ai-mix/save` | 🔑 登录 | ✅ 正常 5ms |
| 4 | POST | `/ai-mix/delete` | 🔑 登录 | ✅ 正常 8ms |
| 5 | POST | `/ai-mix/export` | 🔑 登录 | ✅ 正常 7ms |
| 6 | POST | `/ai-mix/smart-match` | 🔑 登录 | ✅ 正常 9ms |

## ModelGate AI 工具 · `aitools.js`（4 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/ai/tools/status` | 🔑 登录 | ✅ 正常 4ms |
| 2 | POST | `/ai/tools/ocr` | 🔑 登录 | ✅ 正常 6ms |
| 3 | POST | `/ai/tools/asr` | 🔑 登录 | ✅ 正常 7ms |
| 4 | POST | `/ai/tools/segment` | 🔑 登录 | ✅ 正常 4ms |

## AI 点数充值 · `charge.js`（4 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/charge/packages` | 🔑 登录 | ✅ 正常 6ms |
| 2 | POST | `/charge/create` | 🔑 登录 | ✅ 正常 5ms |
| 3 | POST | `/charge/pay` | 🔑 登录 | ✅ 正常 6ms |
| 4 | GET | `/charge/records` | 🔑 登录 | ✅ 正常 4ms |

## 系统直属 · `index.js`（3 个）

| # | 方法 | 路径 | 鉴权 | 运行时探测 |
|---|------|------|------|-----------|
| 1 | GET | `/health` | 🌐 公开 | ⚠️ 告警 4ms |
| 2 | GET | `/api/es/status` | 🌐 公开 | ✅ 正常 2ms |
| 3 | GET | `/api/ai/status` | 🌐 公开 | ✅ 正常 2ms |

---

## 统计汇总

| 指标 | 数量 |
|------|------|
| 端点总数 | **225** |
| 需登录（authRequired） | 210 |
| 需管理员（+adminRequired） | 10 |
| 免鉴权 | 5 |
| SSE 流式端点 | 1（`GET /api/conversations/chat`） |
| 文件上传端点 | 1（`POST /api/material/upload`，multer 单文件 500MB） |
| 静态挂载（未鉴权） | 2（`/uploads/**`、`/api/material/files/**`） |

## 各模块端点分布

| 模块 | 文件 | 端点数 |
|------|------|-------:|
| 创意工具集 | `creative.js` | 36 |
| 会员/脚本海/提现/数字人/商拍 | `biz.js` | 31 |
| 工作台与数据看板 | `workbench.js` | 25 |
| AI 创作任务 | `create.js` | 18 |
| 团队与组织 | `team.js` | 18 |
| 素材资产库 | `material.js` | 16 |
| 广告投放数据 | `ads.js` | 15 |
| 爆款创作 | `hot.js` | 11 |
| AI Agent 会话 | `agent.js` | 10 |
| 认证与账号 | `auth.js` | 10 |
| 系统设置 | `setting.js` | 10 |
| AI 脚本分镜 | `scriptDetail.js` | 8 |
| 智能剪辑 | `aimix.js` | 6 |
| ModelGate AI 工具 | `aitools.js` | 4 |
| AI 点数充值 | `charge.js` | 4 |
| 系统直属 | `index.js` | 3 |

---

## 前端 API 覆盖情况

| 指标 | 数量 |
|------|------|
| 前端定义 API 函数 | 181 |
| 被页面/组件实际调用 | 116 |
| 定义但从未调用（死代码） | 65 |
| 前端调用但后端不存在 | 1（`GET /workbench/data/init/query`，当前未被调用） |

> 后端定义但前端从未调用的"孤儿接口"约 40 余条，多为原站接口还原的预留实现。

---

*回到 [文档索引](./README.md)*
