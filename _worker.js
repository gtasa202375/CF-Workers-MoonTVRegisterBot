export default {
  async fetch(request, env, ctx) {
    const redisURL = env.REDIS_URL || "rediss://default:AYjpAAIncDFlN2YyMDZhMThmYjY0MWIxOGRiZTViYzIxYzM5M2I3MXAxMzUwNDk@outgoing-firefly-35049.upstash.io:6379";
    
    // 解析 Redis URL 并自动生成 REST API 配置
    let redisRestUrl, redisRestToken;
    
    try {
      const url = new URL(redisURL);
      
      // 根据协议判断是否使用 HTTPS
      const protocol = redisURL.startsWith('rediss://') ? 'https' : 'http';
      
      // 构建 REST API URL
      redisRestUrl = `${protocol}://${url.hostname}${url.port ? ':' + url.port : ''}`;
      
      // 提取 token (密码部分)
      redisRestToken = url.password || '';
      
    } catch (error) {
      // 如果解析失败，使用环境变量或默认值
      redisRestUrl = env.UPSTASH_URL || "https://outgoing-firefly-35049.upstash.io";
      redisRestToken = env.UPSTASH_TOKEN || "AYjpAAIncDFlN2YyMDZhMThmYjY0MWIxOGRiZTViYzIxYzM5M2I3MXAxMzUwNDk";
    }
    
    const username = "test";
    try {
      // 使用 Upstash Redis REST API 获取数据
      const response = await fetch(`${redisRestUrl}/get/u:${username}:pwd`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${redisRestToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Redis API request failed: ${response.status} ${response.statusText}`);
      }
      
      const redisResult = await response.json();
      
      // 构建响应数据
      const responseData = {
        key: `u:${username}:pwd`,
        value: redisResult.result,
        timestamp: new Date().toISOString(),
        redis_response: redisResult
      };
      
      // 返回 JSON 响应
      return new Response(JSON.stringify(responseData, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      // 错误处理
      return new Response(JSON.stringify({
        error: "Failed to fetch data from Redis",
        message: error.message,
        timestamp: new Date().toISOString()
      }, null, 2), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};