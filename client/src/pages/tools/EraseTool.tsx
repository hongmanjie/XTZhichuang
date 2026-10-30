import { useState, useRef, useEffect } from 'react'
import { Card, Button, Upload, Slider, Space, message, Spin, Empty, Row, Col, Tag } from 'antd'
import { DeleteOutlined, UploadOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

interface Point { x: number; y: number }

export default function EraseTool() {
  const [imageUrl, setImageUrl] = useState('')
  const [brushSize, setBrushSize] = useState(30)
  const [points, setPoints] = useState<Point[]>([])
  const [drawing, setDrawing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    api.eraseTasks().then((d: any) => setHistory(d.list || [])).catch(() => {})
  }, [])

  // 绘制涂抹区域
  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = imgRef.current
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(108, 92, 231, 0.45)'
    points.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  const getPos = (e: React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    setDrawing(true)
    setPoints((prev) => [...prev, getPos(e)])
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    setPoints((prev) => [...prev, getPos(e)])
  }
  const onMouseUp = () => setDrawing(false)

  useEffect(redraw, [points, brushSize])

  const handleUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setImageUrl(e.target?.result as string)
      setResult('')
      setPoints([])
    }
    reader.readAsDataURL(file)
    return false
  }

  const handleErase = async () => {
    message.info('图片局部修复模型尚未接入，暂时无法执行消除')
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">消除笔</h2>
        <p className="mt-1 text-sm text-gray-500">上传图片，涂抹多余元素，AI 一键智能消除，无缝填充背景</p>
      </div>

      <Row gutter={16}>
        <Col span={16}>
          <Card className="!border-0 shadow-sm">
            {imageUrl ? (
              <div className="relative inline-block">
                <img ref={imgRef} src={imageUrl} alt="待处理" className="max-h-[480px] w-auto rounded-lg" onLoad={redraw} />
                <canvas
                  ref={canvasRef}
                  className="absolute left-0 top-0 cursor-crosshair"
                  style={{ width: imgRef.current?.clientWidth, height: imgRef.current?.clientHeight }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                />
              </div>
            ) : (
              <Upload.Dragger accept="image/*" beforeUpload={handleUpload} showUploadList={false} className="!border-0">
                <div className="py-16">
                  <p className="text-4xl text-gray-300">🖌️</p>
                  <p className="mt-3 text-sm text-gray-500">点击或拖拽上传图片</p>
                  <p className="mt-1 text-xs text-gray-400">支持 JPG / PNG / WEBP，建议小于 10MB</p>
                </div>
              </Upload.Dragger>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="消除设置" className="!border-0 shadow-sm">
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-sm text-gray-600">画笔大小：{brushSize}px</div>
                <Slider min={10} max={80} value={brushSize} onChange={setBrushSize} />
              </div>
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={() => setPoints([])} disabled={!points.length}>
                  清除涂抹
                </Button>
                <Upload accept="image/*" beforeUpload={handleUpload} showUploadList={false}>
                  <Button icon={<UploadOutlined />}>重新上传</Button>
                </Upload>
              </Space>
              <Button type="primary" block size="large" icon={<DeleteOutlined />} loading={loading} onClick={handleErase}>
                开始消除
              </Button>
              <div className="rounded-lg bg-purple-50 p-3 text-xs leading-relaxed text-purple-700">
                <p className="font-medium">使用技巧</p>
                <p className="mt-1">1. 尽量贴近要消除的元素边缘涂抹</p>
                <p className="mt-1">2. 复杂背景可多次涂抹逐步消除</p>
                <p className="mt-1">3. 涂抹越完整，消除效果越自然</p>
              </div>
            </div>
          </Card>

          {result && (
            <Card title="消除结果" className="mt-4 !border-0 shadow-sm">
              <Spin spinning={loading}>
                <img src={result} alt="结果" className="w-full rounded-lg" />
              </Spin>
              <Button block className="mt-3" icon={<DownloadOutlined />} onClick={() => message.success('已保存到资产库')}>
                保存到资产库
              </Button>
            </Card>
          )}
        </Col>
      </Row>

      {history.length > 0 && (
        <Card title="最近处理" className="!border-0 shadow-sm">
          <Row gutter={12}>
            {history.slice(0, 6).map((h: any) => (
              <Col span={4} key={h.id}>
                <div className="overflow-hidden rounded-lg border border-gray-100">
                  <img src={h.result_url || h.source_url} alt="" className="aspect-square w-full object-cover" />
                  <div className="p-1.5 text-center">
                    <Tag color={h.status === 'success' ? 'success' : 'processing'} className="!mr-0 !text-[10px]">
                      {h.status === 'success' ? '已完成' : '处理中'}
                    </Tag>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      )}
      {!imageUrl && !history.length && <Empty description="暂无处理记录" className="py-8" />}
    </div>
  )
}
