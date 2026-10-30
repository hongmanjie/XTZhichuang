import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useUserStore } from './stores/userStore'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AgentTest from './pages/agent/AgentTest'
import AssetLibrary from './pages/asset/AssetLibrary'
import HotCreate from './pages/hot/HotCreate'
import MixList from './pages/aimix/MixList'
import MixEdit from './pages/aimix/MixEdit'
import HitReplica from './pages/create/HitReplica'
import VideoGoldTime from './pages/create/VideoGoldTime'
import AIProductStudio from './pages/create/AIProductStudio'
import VideoGeneration from './pages/create/VideoGeneration'
import VideoAnalysis from './pages/create/VideoAnalysis'
import DigitalHuman from './pages/create/DigitalHuman'
import VoiceStudio from './pages/create/VoiceStudio'
import HdVideo from './pages/create/HdVideo'
import HighlightClips from './pages/create/HighlightClips'
import ThreeSecond from './pages/threeSecond/ThreeSecond'
import MyScripts from './pages/scripts/MyScripts'
import ScriptEditor from './pages/scripts/ScriptEditor'
import EraseTool from './pages/tools/EraseTool'
import DataCompass from './pages/compass/DataCompass'
import DataInfo from './pages/materialData/DataInfo'
import AuthManager from './pages/materialData/AuthManager'
import UserManage from './pages/setting/UserManage'
import RoleManage from './pages/setting/RoleManage'
import AIPointManage from './pages/setting/AIPointManage'
import Consumption from './pages/setting/Consumption'
import LogManage from './pages/setting/LogManage'
import MessageCenter from './pages/setting/MessageCenter'
import TeamManage from './pages/team/TeamManage'
import ProjectManage from './pages/team/ProjectManage'
import Partner from './pages/partner/Partner'
import Charge from './pages/charge/Charge'
import ChargeRecord from './pages/charge/ChargeRecord'
import UserInfoPage from './pages/UserInfo'
import Blog from './pages/Blog'
import FeedbackPage from './pages/Feedback'
import NotFound from './pages/NotFound'

function App() {
  // 必须订阅路由位置：重定向后 Router 状态变化需要驱动 App 重新渲染，
  // 否则会停留在 <Navigate> 分支导致 Routes 永不挂载（白屏）
  const location = useLocation()
  const token = useUserStore((s) => s.token)

  if (!token && !location.pathname.startsWith('/login')) {
    return <Navigate to="/login" replace />
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="agent" element={<AgentTest />} />
        <Route path="agent/:conversationId" element={<AgentTest />} />
        <Route path="asset-library" element={<AssetLibrary />} />
        <Route path="hot" element={<HotCreate />} />
        <Route path="compass" element={<DataCompass />} />
        <Route path="ai-mix" element={<MixList />} />
        <Route path="ai-mix/edit/:id" element={<MixEdit />} />
        <Route path="ai-mix/export/:id" element={<MixEdit />} />
        <Route path="create/hit-replica" element={<HitReplica />} />
        <Route path="create/video-goldTime" element={<VideoGoldTime />} />
        <Route path="create/ai-product-studio" element={<AIProductStudio />} />
        <Route path="create/video-generation" element={<VideoGeneration />} />
        <Route path="create/video-analysis" element={<VideoAnalysis />} />
        <Route path="create/digital-human" element={<DigitalHuman />} />
        <Route path="voice" element={<VoiceStudio />} />
        <Route path="create/hd_video" element={<HdVideo />} />
        <Route path="create/highlight-clips" element={<HighlightClips />} />
        <Route path="create/three-second" element={<ThreeSecond />} />
        <Route path="tools/erase" element={<EraseTool />} />
        <Route path="my-scripts" element={<MyScripts />} />
        <Route path="aiScript/:id/:tab?" element={<ScriptEditor />} />
        <Route path="material_data/dataInfo" element={<DataInfo />} />
        <Route path="material_data/adsVideoData" element={<DataInfo />} />
        <Route path="material_data/authManager" element={<AuthManager />} />
        <Route path="setting/userManage" element={<UserManage />} />
        <Route path="setting/roleManage" element={<RoleManage />} />
        <Route path="setting/aiPointManage" element={<AIPointManage />} />
        <Route path="setting/consumption" element={<Consumption />} />
        <Route path="setting/logManage" element={<LogManage />} />
        <Route path="setting/msgCenter" element={<MessageCenter />} />
        <Route path="team/mine" element={<TeamManage />} />
        <Route path="team/project" element={<ProjectManage />} />
        <Route path="partner" element={<Partner />} />
        <Route path="charge" element={<Charge />} />
        <Route path="chargerecord" element={<ChargeRecord />} />
        <Route path="user/info" element={<UserInfoPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="blog" element={<Blog />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
