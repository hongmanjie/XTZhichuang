// Lightweight adaptation of the local XT workspace's product-video and shot-planning methods.
// The model only plans; the application validates the plan and controls all tool execution.
export function longVideoPlanningMessages({ prompt, durations, ratio, hasFirst, hasLast, mode = 'continuous' }) {
  // 一镜到底适合口播，但每段都要延续上一段，任何一段走样都会拖累后面；
  // 多镜头剪辑每个镜头独立成立，观众看到的是“切换”，不会注意一致性。
  const continuity = mode === 'multishot'
    ? [
        '这是多镜头剪辑，不是一镜到底。每个镜头必须换景别：远景交代环境，中景讲主体，近景或特写讲细节，结尾用定格收束。',
        '相邻镜头之间允许跳切，不要写“保持上一段机位”，要明确写出这一镜的景别与机位。',
        '每个镜头只安排一个主要动作，不要在同一镜头里既换景又做复杂动作。',
        '商品在不同镜头里保持同一款式与颜色，但不要求构图连续。',
      ].join('')
    : [
        '整片按一次连续拍摄来设计：同一空间、同一人物、同一光线，段与段之间不得跳切、不得换景别。',
        '镜头运动只写在第 1 段；后续段落的 camera 一律写“保持上一段机位与景别，不做新的推拉摇移”，避免每段都推近导致越推越近。',
        '每段描述起始画面、动作发展、结束状态；前后镜保持产品、人物、光线、空间和动作接点一致。',
      ].join('')
  return [
    {
      role: 'system',
      content: [
        '你是电商视频导演，把用户要求拆成连续、可执行的视频镜头。',
        '只依据用户文字，不要声称已经看过参考图；不得编造产品成分、功效、价格、销量、认证或用户评价。',
        continuity,
        '避免依赖生成可读包装文字或字幕。所有镜头共享视觉风格；已有首尾帧分别用于全片开头和结尾。',
        '只输出 JSON：{"visual_style":"统一视觉风格","music":"全片配乐描述","shots":[{"visual":"本镜画面与主体","start":"起始状态","action":"动作发展","camera":"运镜","end":"结束状态","soundscape":"环境声"}]}。不要输出解释。',
      ].join(''),
    },
    {
      role: 'user',
      content: `创作描述：${prompt}\n目标画幅：${ratio}。共 ${durations.length} 段，时长依次为 ${durations.join('、')} 秒。首帧：${hasFirst ? '用户提供' : '无'}；尾帧：${hasLast ? '用户提供' : '无'}。`,
    },
  ]
}
