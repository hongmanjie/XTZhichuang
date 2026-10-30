import axios from 'axios'
import { message } from 'antd'
import { useUserStore } from '../stores/userStore'

const request = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

// 请求拦截：注入token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 统一登出：清空 store + localStorage，并跳回登录页（登录页本身除外）
const forceLogout = (msg?: string) => {
  useUserStore.getState().logout()
  if (!location.pathname.startsWith('/login')) {
    if (msg) message.warning(msg)
    location.href = '/login'
  }
}

// 响应拦截：统一处理（拦截器已解包为 data.data）
request.interceptors.response.use(
  (res): any => {
    const data = res.data || {}
    if (data.code === 0) {
      return data.data
    }
    if (data.code === 401) {
      forceLogout(data.message || '登录已过期')
      return Promise.reject(new Error(data.message))
    }
    // 点数不足：触发全局充值引导弹窗（由 MainLayout 监听），不再弹普通错误提示
    if (typeof data.message === 'string' && data.message.includes('点数不足')) {
      window.dispatchEvent(new CustomEvent('mf:insufficient-points', { detail: { message: data.message } }))
      return Promise.reject(new Error(data.message))
    }
    message.error(data.message || '请求失败')
    return Promise.reject(new Error(data.message))
  },
  (err): any => {
    if (err.code === 'ECONNABORTED') {
      message.error('请求超时，请稍后重试')
    } else if (err.response?.status === 401) {
      forceLogout()
    } else {
      message.error(err.message || '网络错误')
    }
    return Promise.reject(err)
  }
)

export default request

// ============ 类型化请求包装（拦截器返回的是解包后的 data.data） ============
const get = <T = any>(url: string, config?: any): Promise<T> => request.get(url, config) as unknown as Promise<T>
const post = <T = any>(url: string, data?: any, config?: any): Promise<T> => request.post(url, data, config) as unknown as Promise<T>
const del = <T = any>(url: string): Promise<T> => request.delete(url) as unknown as Promise<T>

// ============ API 定义 ============
export const api = {
  // 认证
  login: (data: { account: string; password: string }) => post('/login', data),
  loginInit: () => get('/login/init'),
  logout: () => post('/logout'),
  mediaSession: () => post('/media/session'),
  userInfo: () => get('/user/info'),
  updateUser: (data: any) => post('/user/edit/save', data),
  changePassword: (data: any) => post('/user/password', data),
  featureStatus: () => get('/account/feature/status/list'),
  topMessage: () => get('/account/top/message'),
  versionNotice: () => get('/account/version/notice'),
  activityPopup: () => get('/activity/popup/get'),

  // 团队
  departments: () => get('/department/list'),
  saveDepartment: (data: any) => post('/department/save', data),
  deleteDepartment: (data: any) => post('/department/delete', data),
  brands: () => get('/brand/list'),
  saveBrand: (data: any) => post('/brand/save', data),
  deleteBrand: (data: any) => post('/brand/delete', data),
  members: (params?: any) => get('/team/member/list', { params }),
  saveMember: (data: any) => post('/team/member/save', data),
  memberStatus: (data: any) => post('/team/member/status', data),
  deleteMember: (data: any) => post('/team/member/delete', data),
  roles: () => get('/role/list'),
  saveRole: (data: any) => post('/role/save', data),
  deleteRole: (data: any) => post('/role/delete', data),
  authorities: () => get('/role/authority/info'),
  partnerInfo: () => get('/partner/info'),

  // 素材资产
  materials: (params?: any) => get('/material/list', { params }),
  materialDetail: (id: number) => get('/material/detail', { params: { id } }),
  uploadMaterial: (formData: FormData) =>
    post('/material/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  voiceProfiles: () => get('/voice/profiles'),
  uploadVoice: (data: FormData) => post('/voice/profiles', data, { timeout: 150000 }),
  deleteVoice: (id: number) => del(`/voice/profiles/${id}`),
  dubVoice: (data: any) => post('/voice/dub', data),
  updateMaterial: (data: any) => post('/material/update', data),
  deleteMaterials: (data: any) => post('/material/delete', data),
  materialCategories: () => get('/material/categories'),
  folders: () => get('/folder/list'),
  saveFolder: (data: any) => post('/folder/save', data),
  deleteFolder: (data: any) => post('/folder/delete', data),
  assetStatistics: () => get('/asset/statistics'),

  // 脚本
  scripts: (params?: any) => get('/script/list', { params }),
  scriptDetail: (id: number) => get('/script/detail', { params: { id } }),
  saveScript: (data: any) => post('/script/save', data),
  deleteScripts: (data: any) => post('/script/delete', data),

  // AI脚本分镜
  subitems: (scriptId: number) => get('/ai/script/subitem/list', { params: { scriptId } }),
  subitemEdit: (data: any) => post('/ai/script/subitem/edit', data),
  subitemSplit: (data: any) => post('/ai/script/subitem/split/edit', data),
  subitemStructure: (data: any) => post('/ai/script/subitem/structure/edit', data),
  scriptGenerate: (data: any) => post('/ai/script/intelligent/generation', data),
  scriptGenRecord: (scriptId: number) => get('/ai/script/generation/record', { params: { scriptId } }),
  scriptDictate: (data: any) => post('/ai/script/dictate/script/generation', data),
  scriptPolish: (data: any) => post('/ai/script/polish', data),

  // 作品
  works: (params?: any) => get('/work/list', { params }),
  deleteWork: (data: any) => post('/work/delete', data),

  // 爆款
  hotList: (params?: any) => get('/hot/list', { params }),
  hotDetail: (id: number) => get('/hot/detail', { params: { id } }),
  hotCategories: () => get('/hot/categories'),
  hotPlatforms: () => get('/hot/platforms'),
  parseShareUrl: (data: { url: string }) => post('/viral/replica/parseShareUrl', data),

  // 智能剪辑
  mixList: (params?: any) => get('/ai-mix/list', { params }),
  mixDetail: (id: number) => get('/ai-mix/detail', { params: { id } }),
  saveMix: (data: any) => post('/ai-mix/save', data),
  deleteMix: (data: any) => post('/ai-mix/delete', data),
  exportMix: (data: any) => post('/ai-mix/export', data),
  smartMatch: (data: any) => post('/ai-mix/smart-match', data),

  // AI Agent
  skills: () => get('/skills'),
  skillOptions: () => get('/skills/options'),
  conversations: (params?: any) => get('/conversations', { params }),
  createConversation: (data?: any) => post('/conversations', data),
  conversationMessages: (id: number) => get(`/conversations/${id}/messages`),
  deleteConversation: (data: any) => post('/conversations/delete', data),

  // AI创作
  createReplica: (data: any) => post('/create/replica', data),
  createFactory: (data: any) => post('/create/factory', data),
  createStudio: (data: any) => post('/create/studio', data),
  prepareStudio: (data: { imageUrl: string }) => post('/create/studio/prepare', data, { timeout: 180000 }),
  createMaterialField: (data: any) => post('/create/materialField', data),
  createAnalysis: (data: any) => post('/create/analysis', data),
  createVideoAnalysis: (data: any) => post('/video-analysis/create', data),
  createHuman: (data: any) => post('/create/human', data),
  tasks: (params?: any) => get('/task/list', { params }),
  taskDetail: (id: number) => get('/task/detail', { params: { id } }),
  retryTask: (data: any) => post('/task/retry', data),
  cancelTask: (data: any) => post('/task/cancel', data),
  deleteTasks: (data: any) => post('/task/delete', data),
  digitalHumans: () => get('/digital_human/list'),
  humanVoices: () => get('/digital_human/voices'),
  // 数字人场景约束创作链路（场景背景/IP形象/合成首帧）
  createHumanAsset: (data: any) => post('/create/human-asset', data),
  digitalHumanScenes: () => get('/digital_human/scenes'),
  digitalHumanAssets: (params?: any) => get('/digital_human/assets', { params }),
  deleteHumanAsset: (id: number) => request.delete(`/digital_human/assets/${id}`),
  studioCategories: () => get('/ai/commerce/photo/category/list'),
  optimizePrompt: (data: any) => post('/ai/factory/prompt/optimize', data),
  aiStatus: () => get('/ai/status'),

  // AI素材场（深度复刻原站）
  mfConfig: () => get('/mf/config'),
  mfCases: (params?: any) => get('/mf/cases', { params }),
  mfAvatars: () => get('/mf/avatars'),
  mfPrompt: (data: any) => post('/ai/mf/prompt', data),

  // 投放数据
  advertisers: (params?: any) => get('/ad/launch/advertiser/list', { params }),
  saveAdvertiser: (data: any) => post('/ad/launch/advertiser/save', data),
  deleteAdvertiser: (data: any) => post('/ad/launch/advertiser/delete', data),
  adGroups: (params?: any) => get('/ad/launch/group/list', { params }),
  saveAdGroup: (data: any) => post('/ad/launch/group/save', data),
  deleteAdGroup: (data: any) => post('/ad/launch/group/delete', data),
  adOverview: (params?: any) => get('/ad/launch/data/overview', { params }),
  adDataList: (params?: any) => get('/ad/launch/data/list', { params }),
  adPageInit: () => get('/ad/launch/page/init'),

  // 设置
  aiPointOverview: () => get('/setting/aiPoint/overview'),
  grantPoints: (data: any) => post('/setting/aiPoint/grant', data),
  consumption: (params?: any) => get('/setting/consumption/list', { params }),
  logs: (params?: any) => get('/setting/log/list', { params }),

  // 充值
  chargePackages: () => get('/charge/packages'),
  chargeMemberStatus: () => get('/charge/memberStatus'),
  createCharge: (data: any) => post('/charge/create', data),
  payCharge: (data: any) => post('/charge/pay', data),
  chargeRecords: (params?: any) => get('/charge/records', { params }),

  // ============ 工作台/看板 ============
  workbenchInit: () => get('/workbench/data/init/new'),
  workbenchQuery: () => get('/workbench/data/init/query'),
  boardInit: () => get('/data/board/config/init'),
  boardBriefing: () => get('/data/board/config/briefing'),
  boardTrend: () => get('/data/board/config/trend'),
  boardCore: () => get('/data/board/config/core'),
  boardRanking: () => get('/data/board/config/ranking'),
  boardTarget: () => get('/data/board/config/target'),
  boardExcellentWorks: () => get('/data/board/config/excellent/works'),
  boardFunction: () => get('/data/board/config/function'),
  newUserTasks: () => get('/new/user/reward/task/list'),
  newUserGuide: () => get('/new/user/reward/is/show/guide'),
  claimReward: (data: { taskId: number }) => post('/new/user/reward/claim', data),
  behaviorReport: (data: any) => post('/behavior/report', data),

  // ============ 消息中心 ============
  messages: (params?: any) => get('/message/center/list/info', { params }),
  unreadMessages: () => get('/message/center/unread/message'),
  readMessages: (data: { ids: number[] }) => post('/message/center/message/batch', data),
  messageBody: (id: number) => get('/message/center/query/body', { params: { id } }),

  // ============ 任务中心 ============
  taskCenterCount: () => get('/task/center/unread/count'),
  taskCenterPage: (params?: any) => get('/task/center/upload/page', { params }),
  taskCenterBind: (data: any) => post('/task/center/upload/bind', data),

  // ============ 精彩片段 ============
  highlightInit: () => get('/highlight/editing/init'),
  highlightTasks: (params?: any) => get('/highlight/editing/task/list', { params }),
  highlightOverview: () => get('/highlight/editing/task/overview'),
  highlightCreate: (data: any) => post('/highlight/editing/task/create', data),
  highlightClips: (taskId: number) => get('/highlight/editing/clip/list', { params: { taskId } }),
  highlightClipDetail: (id: number) => get('/highlight/editing/clip/detail', { params: { id } }),
  highlightClipTitle: (data: any) => post('/highlight/editing/clip/title/update', data),
  highlightClipPublish: (data: any) => post('/highlight/editing/clip/publish', data),
  highlightClipSave: (data: any) => post('/highlight/editing/clip/save/material', data),
  highlightClipDelete: (data: any) => post('/highlight/editing/clip/delete', data),
  highlightTaskDelete: (data: any) => post('/highlight/editing/task/delete', data),

  // ============ 三秒完播 ============
  threeSecondCategories: () => get('/three/second/category/list'),
  threeSecondDemos: () => get('/three/second/demo/list'),
  threeSecondMake: (data: any) => post('/three/second/make/video', data),
  threeSecondDelete: (data: any) => post('/three/second/task/delete', data),

  // ============ 高清视频 ============
  superResInit: () => get('/super/resolution/init/info/new'),
  superResCreate: (data: any) => post('/super/resolution/create/new', data),
  superResTasks: () => get('/super/resolution/task/list'),
  superResDelete: (data: any) => post('/super/resolution/task/delete', data),

  // ============ 视频解析 ============
  sceneAnalysisSubmit: (data: any) => post('/video/scene/analysis/submit', data),
  sceneAnalysisList: () => get('/video/scene/analysis/list'),
  sceneAnalysisRetry: (data: any) => post('/video/scene/analysis/retry', data),
  sceneAnalysisDelete: (data: any) => post('/video/scene/analysis/delete', data),

  // ============ 消除笔 ============
  eraseSubmit: (data: any) => post('/tools/erase/submit', data),
  eraseTasks: () => get('/tools/erase/task/list'),
  eraseDelete: (data: any) => post('/tools/erase/task/delete', data),

  // ============ 音乐库 ============
  musicCategories: () => get('/music/category/list'),
  musicList: () => get('/music/list/info'),
  musicByCategory: (category: string) => get('/music/list/by/category', { params: { category } }),
  musicUpload: (data: any) => post('/music/upload/info', data),
  musicDelete: (data: any) => post('/music/delete', data),
  subtitleInit: () => get('/subtitle/material/init/info'),

  // ============ 数据罗盘 ============
  compassInit: () => get('/data/compass/video/init/config'),
  compassList: (params?: any) => get('/data/compass/video/list/info', { params }),
  compassParse: (data: any) => post('/data/compass/video/query/url', data),
  compassAnalysis: (data: any) => post('/data/compass/video/analysis', data),
  compassAnalysisResult: (id: number) => get('/data/compass/video/analysis/result', { params: { id } }),

  // ============ 混剪反馈 ============
  feedbackInit: () => get('/video/montage/feedback/init'),
  feedbackSubmit: (data: any) => post('/video/montage/feedback/submit', data),

  // ============ 会员 ============
  memberInit: () => get('/member/order/page/init'),
  memberCreate: (data: any) => post('/member/order/create/order', data),
  memberOrders: (params?: any) => get('/member/order/list/info', { params }),

  // ============ 脚本海 ============
  scriptSeaList: (params?: any) => get('/script/sea/info/list', { params }),
  scriptSeaDetail: (id: number) => get('/script/sea/detail/info', { params: { id } }),
  scriptSeaClaim: (data: any) => post('/script/sea/claim/submit', data),

  // ============ 我的项目 ============
  myProjects: () => get('/my/project/script/init'),
  myProjectTeam: (type?: string) => get('/my/project/team/item', { params: { type } }),
  myProjectAddScript: (data: any) => post('/my/project/add/script/new', data),
  myProjectDeleteScript: (data: any) => post('/my/project/delete/script', data),
  myProjectRenameScript: (data: any) => post('/my/project/edit/script/name', data),

  // ============ 合作伙伴/提现 ============
  withdrawInit: () => get('/withdraw/init'),
  withdrawPage: () => get('/withdraw/page/init'),
  withdrawSubmit: (data: any) => post('/withdraw/submit', data),
  withdrawLogs: (params?: any) => get('/withdraw/withdrawal/log', { params }),
  withdrawInvite: () => post('/withdraw/invite/friend', {}),
  withdrawFriendRecharge: () => get('/withdraw/friend/recharge'),
  withdrawBind: (data: any) => post('/withdraw/add/binding/info', data),

  // ============ 数字人形象 ============
  avatars: () => get('/ip/avatar/filter/List'),
  avatarIndustries: () => get('/ip/avatar/industry/list'),
  avatarPersonInit: () => get('/ip/avatar/person/init/info'),
  avatarBackgrounds: () => get('/ip/avatar/background/list'),
  avatarVoices: () => get('/ip/avatar/voice/list'),

  // ============ AI商拍模板 ============
  commerceTemplates: (params?: any) => get('/ai/commerce/photo/template/list/v2', { params }),
  commerceDirections: () => get('/ai/commerce/photo/template/generate/direction/list'),
  commerceDemos: () => get('/ai/commerce/photo/demo/list'),
  commerceInit: () => get('/ai/commerce/photo/initInfo'),

  // ============ 案例教程 ============
  courseCategories: () => get('/case/course/category/list'),
  courseList: () => get('/case/course/demo/list'),
}
