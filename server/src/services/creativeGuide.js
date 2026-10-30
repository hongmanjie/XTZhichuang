// Lightweight adaptation of the local XT workspace's product-video and shot-planning methods.
// The model only plans; the application validates the plan and controls all tool execution.
export function longVideoPlanningMessages({ prompt, durations, ratio, hasFirst, hasLast }) {
  return [
    {
      role: 'system',
      content: [
        '你是电商视频导演，把用户要求拆成连续、可执行的视频镜头。',
        '只依据用户文字，不要声称已经看过参考图；不得编造产品成分、功效、价格、销量、认证或用户评价。',
        '每段清楚描述起始画面、动作发展、镜头运动、结束状态；前后镜保持产品、人物、光线、空间和动作接点一致。',
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
