import { Button, Card, Empty } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function Charge() {
  const navigate = useNavigate()
  return <div className="mx-auto max-w-4xl"><h1 className="mb-2 text-xl font-bold">充值与会员</h1><p className="mb-6 text-sm text-gray-500">在线支付尚未接入，暂不能进行充值或开通会员。</p><Card><Empty description="如需调整点数，请联系管理员" /><div className="mt-4 text-center"><Button onClick={() => navigate('/chargerecord')}>查看历史订单</Button></div></Card></div>
}
