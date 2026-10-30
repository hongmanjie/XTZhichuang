// 统一响应格式
export function success(data = null, message = 'success') {
  return { code: 0, data, message }
}

export function fail(message = '请求失败', code = 500) {
  return { code, data: null, message }
}

// 分页响应
export function page(list, total, pageNum = 1, pageSize = 10) {
  return {
    code: 0,
    data: { list, total, pageNum, pageSize },
    message: 'success',
  }
}

// 异步路由包装
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
