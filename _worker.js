export default {
  async fetch(request, env, ctx) {
    // Upstash Redis REST API 配置
    const redisRestUrl = env.REDIS_REST_URL || "https://outgoing-firefly-35049.upstash.io";
    const redisRestToken = env.REDIS_REST_TOKEN || "AYjpAAIncDFlN2YyMDZhMThmYjY0MWIxOGRiZTViYzIxYzM5M2I3MXAxMzUwNDk";
    
    try {
      // 使用 Upstash Redis REST API 获取数据
      const response = await fetch(`${redisRestUrl}/get/u:xvxvxv:pwd`, {
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
        key: "u:xvxvxv:pwd",
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