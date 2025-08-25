// 添加TCP连接支持
import { connect } from 'cloudflare:sockets';

// MD5 加密函数
async function md5(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// 生成初始密码
function generateInitialPassword(userId) {
    const timestamp = Date.now();
    const rawText = `${userId}${timestamp}`;
    return md5(rawText).then(hash => hash.substring(0, 8));
}

export default {
    async fetch(request, env, ctx) {
        const redisURL = env.REDIS_URL || "redis://tcp.sg-members-1.clawcloudrun.com:32025";
        const token = env.TOKEN || "token";
        const bot_token = env.BOT_TOKEN || "8226743743:AAHfrc09vW8cxKHyU0q0YKPuCXrW1ICWdU0";
        const GROUP_ID = env.GROUP_ID || "-1002563172210";

        // 解析 Redis URL 并自动生成 REST API 配置
        let redisRestUrl, redisRestToken, redisType;

        try {
            const url = new URL(redisURL);
            
            // 检测Redis服务类型
            if (redisURL.includes('upstash.io') || redisURL.startsWith('rediss://')) {
                // Upstash Redis 或 SSL Redis (支持REST API)
                redisType = 'rest_api';
                const protocol = redisURL.startsWith('rediss://') ? 'https' : 'http';
                redisRestUrl = `${protocol}://${url.hostname}${url.port ? ':' + url.port : ''}`;
                redisRestToken = url.password || '';
            } else if (redisURL.startsWith('redis://')) {
                // 传统Redis服务 (使用TCP连接)
                redisType = 'tcp_redis';
                redisRestUrl = redisURL; // 保存原始URL用于TCP连接
                redisRestToken = url.password || null;
            } else {
                // 未知类型，尝试作为REST API处理
                redisType = 'unknown';
                const protocol = redisURL.startsWith('https://') ? 'https' : 'http';
                redisRestUrl = redisURL.startsWith('http') ? redisURL : `${protocol}://${url.hostname}${url.port ? ':' + url.port : ''}`;
                redisRestToken = url.password || '';
            }
        } catch (error) {
            redisType = 'invalid';
            redisRestUrl = null;
            redisRestToken = null;
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // 处理 Webhook 初始化路径
        if (path.includes(`/${token}`)) {
            return await handleWebhookInit(bot_token, request.url, token);
        }

        // 处理检测路径
        if (path === '/check' && request.method === 'GET') {
            const urlParams = new URLSearchParams(url.search);
            const checkToken = urlParams.get('token');
            
            if (checkToken === token) {
                return await handleCheckEndpoint(redisRestUrl, redisRestToken, redisType, redisURL);
            } else {
                return new Response("Forbidden", { status: 403 });
            }
        }

        // 处理 Telegram Webhook
        if (request.method === 'POST') {
            return await handleTelegramWebhook(request, bot_token, GROUP_ID, redisRestUrl, redisRestToken, redisType);
        }

        // 默认返回404错误页面（伪装）
        return new Response("Not Found", { status: 404 });
    },
};

// 处理检测端点
async function handleCheckEndpoint(redisRestUrl, redisRestToken, redisType, originalRedisURL) {
    const checkResult = {
        timestamp: new Date().toISOString(),
        redisConnection: {
            url: redisRestUrl,
            type: redisType,
            originalUrl: originalRedisURL,
            status: 'unknown',
            error: null,
            responseTime: null
        },
        adminConfig: null,
        errors: []
    };

    let startTime = Date.now();

    try {
        // 检查Redis类型是否支持
        if (redisType === 'tcp_redis') {
            // TCP Redis连接测试
            console.log('Testing TCP Redis connection...');
            const pingResult = await pingTcpRedis(redisRestUrl, redisRestToken);
            
            checkResult.redisConnection.responseTime = Date.now() - startTime;
            
            if (!pingResult) {
                checkResult.redisConnection.status = 'error';
                checkResult.redisConnection.error = 'TCP Redis连接失败或认证失败';
                checkResult.errors.push('TCP Redis连接失败');
            } else {
                checkResult.redisConnection.status = 'connected';
                console.log('TCP Redis ping successful, trying to read admin:config...');
                
                // 连接成功，尝试读取admin:config
                try {
                    const configData = await getRedisValue(redisRestUrl, redisRestToken, 'admin:config', redisType);
                    
                    if (configData === null) {
                        checkResult.errors.push('admin:config键不存在或为空');
                        checkResult.adminConfig = null;
                    } else {
                        try {
                            // 尝试解析为JSON
                            checkResult.adminConfig = JSON.parse(configData);
                            console.log('Successfully parsed admin:config');
                        } catch (parseError) {
                            checkResult.errors.push(`admin:config解析失败: ${parseError.message}`);
                            checkResult.adminConfig = {
                                raw: configData,
                                parseError: parseError.message
                            };
                        }
                    }
                } catch (configError) {
                    checkResult.errors.push(`读取admin:config失败: ${configError.message}`);
                    checkResult.adminConfig = null;
                }
            }
        } else if (redisType === 'invalid') {
            checkResult.redisConnection.status = 'invalid_url';
            checkResult.redisConnection.error = 'Redis URL格式无效';
            checkResult.errors.push('Redis URL格式错误，请检查REDIS_URL环境变量');
            
            checkResult.redisConnection.responseTime = Date.now() - startTime;
        } else if (!redisRestUrl) {
            checkResult.redisConnection.status = 'config_error';
            checkResult.redisConnection.error = '无法解析Redis配置';
            checkResult.errors.push('Redis配置解析失败，请检查REDIS_URL环境变量');
            
            checkResult.redisConnection.responseTime = Date.now() - startTime;
        } else {
            // 测试Redis连接状态
            console.log('Testing Redis connection...');
            
            // 首先测试一个简单的ping操作
            const pingResponse = await fetch(`${redisRestUrl}/ping`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${redisRestToken}`,
                    'Content-Type': 'application/json',
                },
            });

            checkResult.redisConnection.responseTime = Date.now() - startTime;

            if (!pingResponse.ok) {
                checkResult.redisConnection.status = 'error';
                checkResult.redisConnection.error = `Redis ping failed with status: ${pingResponse.status} ${pingResponse.statusText}`;
                checkResult.errors.push(`Redis连接失败: HTTP ${pingResponse.status}`);
                
                // 尝试获取更详细的错误信息
                try {
                    const errorText = await pingResponse.text();
                    if (errorText) {
                        checkResult.redisConnection.error += ` - ${errorText}`;
                    }
                } catch (e) {
                    // 忽略读取错误内容的异常
                }
            } else {
                checkResult.redisConnection.status = 'connected';
                console.log('Redis ping successful, trying to read admin:config...');
                
                // 连接成功，尝试读取admin:config
                try {
                    const configData = await getRedisValue(redisRestUrl, redisRestToken, 'admin:config', redisType);
                    
                    if (configData === null) {
                        checkResult.errors.push('admin:config键不存在或为空');
                        checkResult.adminConfig = null;
                    } else {
                        try {
                            // 尝试解析为JSON
                            checkResult.adminConfig = JSON.parse(configData);
                            console.log('Successfully parsed admin:config');
                        } catch (parseError) {
                            checkResult.errors.push(`admin:config解析失败: ${parseError.message}`);
                            checkResult.adminConfig = {
                                raw: configData,
                                parseError: parseError.message
                            };
                        }
                    }
                } catch (configError) {
                    checkResult.errors.push(`读取admin:config失败: ${configError.message}`);
                    checkResult.adminConfig = null;
                }
            }
        }
    } catch (networkError) {
        checkResult.redisConnection.status = 'network_error';
        checkResult.redisConnection.responseTime = Date.now() - startTime;
        checkResult.redisConnection.error = networkError.message;
        checkResult.errors.push(`网络错误: ${networkError.message}`);
        
        // 分析可能的网络问题
        if (networkError.message.includes('fetch')) {
            checkResult.errors.push('可能的原因: 1) Redis URL配置错误 2) 网络连接问题 3) 防火墙阻拦');
        }
        if (networkError.message.includes('timeout')) {
            checkResult.errors.push('连接超时，请检查Redis服务状态');
        }
        if (networkError.message.includes('SSL') || networkError.message.includes('TLS')) {
            checkResult.errors.push('SSL/TLS连接问题，请检查Redis是否支持SSL连接');
        }
    }

    // 添加诊断建议
    const diagnostics = [];
    
    if (checkResult.redisConnection.status === 'error') {
        if (redisType === 'tcp_redis') {
            diagnostics.push('TCP Redis连接失败，请检查：');
            diagnostics.push('1. Redis服务器地址和端口是否正确');
            diagnostics.push('2. Redis服务器是否正常运行');
            diagnostics.push('3. 如果Redis设置了密码，请确认密码正确');
            diagnostics.push('4. 网络是否可达Redis服务器');
        } else {
            diagnostics.push('请检查REDIS_URL环境变量是否正确配置');
            diagnostics.push('请确认Redis服务是否正常运行');
        }
    }
    
    if (checkResult.adminConfig === null && checkResult.redisConnection.status === 'connected') {
        diagnostics.push('Redis连接正常但admin:config不存在，请确认数据是否已正确初始化');
    }
    
    if (checkResult.redisConnection.responseTime && checkResult.redisConnection.responseTime > 5000) {
        diagnostics.push('Redis响应时间较长，可能存在网络延迟问题');
    }

    checkResult.diagnostics = diagnostics;
    checkResult.summary = {
        redisOk: checkResult.redisConnection.status === 'connected',
        configOk: checkResult.adminConfig !== null && !checkResult.adminConfig.parseError,
        overallStatus: checkResult.redisConnection.status === 'connected' && 
                      checkResult.adminConfig !== null && 
                      !checkResult.adminConfig.parseError ? 'healthy' : 'unhealthy'
    };

    return new Response(JSON.stringify(checkResult, null, 2), {
        headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        },
    });
}

// 初始化 Webhook
async function handleWebhookInit(bot_token, workerUrl, token) {
    try {
        const webhookUrl = workerUrl.replace(`/${token}`, '');

        // 设置 webhook
        const setWebhookResponse = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
            }),
        });

        const setWebhookResult = await setWebhookResponse.json();

        // 设置机器人命令
        const setCommandsResponse = await fetch(`https://api.telegram.org/bot${bot_token}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commands: [
                    { command: "start", description: "注册/查看用户信息" },
                    { command: "pwd", description: "修改访问密码" }
                ]
            }),
        });

        const setCommandsResult = await setCommandsResponse.json();

        return new Response(JSON.stringify({
            webhook: setWebhookResult,
            commands: setCommandsResult,
            message: "Bot initialized successfully"
        }, null, 2), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: "Failed to initialize bot",
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// 处理 Telegram Webhook
async function handleTelegramWebhook(request, bot_token, GROUP_ID, redisRestUrl, redisRestToken, redisType) {
    try {
        // 检查Redis配置是否有效
        if (redisType === 'invalid' || !redisRestUrl) {
            console.error('Redis configuration invalid:', redisType);
            return new Response('OK'); // 静默忽略，避免Telegram重试
        }

        const update = await request.json();

        if (update.message && update.message.text) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;

            // 处理 /start 命令
            if (text === '/start') {
                return await handleStartCommand(bot_token, userId, chatId, GROUP_ID, redisRestUrl, redisRestToken, redisType);
            }

            // 处理 /pwd 命令
            if (text.startsWith('/pwd')) {
                if (text === '/pwd' || text.trim() === '/pwd') {
                    // 用户只输入了 /pwd 没有提供密码
                    await sendMessage(bot_token, chatId, "❌ 请输入要修改的新密码\n\n💡 使用方法：/pwd 新密码\n📝 示例：/pwd 12345678\n\n这样就会将密码改为 12345678");
                    return new Response('OK');
                } else if (text.startsWith('/pwd ')) {
                    const newPassword = text.substring(5).trim();
                    return await handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, redisRestUrl, redisRestToken, redisType);
                }
            }
        }

        return new Response('OK');
    } catch (error) {
        console.error('Error handling webhook:', error);
        return new Response('Error', { status: 500 });
    }
}

// 处理 /start 命令
async function handleStartCommand(bot_token, userId, chatId, GROUP_ID, redisRestUrl, redisRestToken, redisType) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            await sendMessage(bot_token, chatId, "⚠️ 当前用户无注册权限，请先加入指定群组。");
            return new Response('OK');
        }

        // 检查用户是否已注册
        const userKey = `u:${userId}:pwd`;
        const existingUser = await getRedisValue(redisRestUrl, redisRestToken, userKey, redisType);

        let responseMessage;

        if (existingUser === null) {
            // 用户未注册，创建新账户
            const initialPassword = await generateInitialPassword(userId);
            await setRedisValue(redisRestUrl, redisRestToken, userKey, initialPassword, redisType);

            // 将用户添加到admin:config中
            const configUpdateResult = await addUserToConfig(redisRestUrl, redisRestToken, userId.toString(), redisType);

            if (configUpdateResult.success) {
                responseMessage = `✅ 注册成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码`;
            } else {
                // 即使配置更新失败，也算注册成功，只是给出警告
                console.log('Config update failed, but user account created successfully');
                responseMessage = `✅ 注册成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n⚠️ 注意：配置更新遇到问题，但不影响登录使用`;
            }
        } else {
            // 用户已存在，显示当前信息
            responseMessage = `ℹ️ 你已注册过账户\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${existingUser}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码`;
        }

        await sendMessage(bot_token, chatId, responseMessage);
        return new Response('OK');
    } catch (error) {
        console.error('Error in start command:', error);
        await sendMessage(bot_token, chatId, "❌ 操作失败，请稍后再试。");
        return new Response('OK');
    }
}

// 处理 /pwd 命令
async function handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, redisRestUrl, redisRestToken, redisType) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            await sendMessage(bot_token, chatId, "⚠️ 当前用户无权限，请先加入指定群组。");
            return new Response('OK');
        }

        if (!newPassword || newPassword.length < 6) {
            await sendMessage(bot_token, chatId, "❌ 密码长度至少6位，请重新输入。\n\n💡 使用方法：/pwd 你的新密码");
            return new Response('OK');
        }

        // 检查用户是否已注册
        const userKey = `u:${userId}:pwd`;
        const existingUser = await getRedisValue(redisRestUrl, redisRestToken, userKey, redisType);

        if (existingUser === null) {
            await sendMessage(bot_token, chatId, "❌ 用户未注册，请先使用 /start 命令注册账户。");
            return new Response('OK');
        }

        // 更新密码
        await setRedisValue(redisRestUrl, redisRestToken, userKey, newPassword, redisType);

        await sendMessage(bot_token, chatId, `✅ 密码修改成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${newPassword}</code>\n\n💡 新密码已生效`);
        return new Response('OK');
    } catch (error) {
        console.error('Error in password command:', error);
        await sendMessage(bot_token, chatId, "❌ 密码修改失败，请稍后再试。");
        return new Response('OK');
    }
}

// 检查用户是否在群组中
async function checkUserInGroup(bot_token, groupId, userId) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${bot_token}/getChatMember`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: groupId,
                user_id: userId
            }),
        });

        const result = await response.json();

        if (result.ok) {
            const status = result.result.status;
            return ['creator', 'administrator', 'member'].includes(status);
        }

        return false;
    } catch (error) {
        console.error('Error checking group membership:', error);
        return false;
    }
}

// 发送消息
async function sendMessage(bot_token, chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            }),
        });
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

// TCP Redis连接函数
async function connectToRedis(redisUrl) {
    const url = new URL(redisUrl);
    const socket = connect({
        hostname: url.hostname,
        port: parseInt(url.port) || 6379,
    });
    return socket;
}

// 专门处理Redis SET命令的函数，支持大数据
async function sendRedisSetCommand(socket, key, value) {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    
    try {
        // 构建Redis协议SET命令
        // 格式: *3\r\n$3\r\nSET\r\n$keylen\r\nkey\r\n$valuelen\r\nvalue\r\n
        const keyBytes = new TextEncoder().encode(key);
        const valueBytes = new TextEncoder().encode(value);
        
        let command = `*3\r\n`;                           // 3个参数
        command += `$3\r\nSET\r\n`;                      // SET命令
        command += `$${keyBytes.length}\r\n${key}\r\n`;  // 键
        command += `$${valueBytes.length}\r\n${value}\r\n`; // 值
        
        console.log(`Sending SET command: key=${key}, value_length=${valueBytes.length}`);
        
        // 发送命令
        await writer.write(new TextEncoder().encode(command));
        
        // 读取响应 - 使用与GET相同的完整读取逻辑
        let responseBuffer = new Uint8Array();
        let response = '';
        let isComplete = false;
        
        while (!isComplete) {
            const { value: readValue, done } = await reader.read();
            
            if (done) {
                break;
            }
            
            // 拼接数据
            const newBuffer = new Uint8Array(responseBuffer.length + readValue.length);
            newBuffer.set(responseBuffer);
            newBuffer.set(readValue, responseBuffer.length);
            responseBuffer = newBuffer;
            
            // 转换为字符串进行分析
            response = new TextDecoder().decode(responseBuffer);
            
            // SET命令通常返回简单响应如+OK\r\n
            if (response.startsWith('+') || response.startsWith('-')) {
                if (response.includes('\r\n')) {
                    isComplete = true;
                }
            } else {
                // 其他情况，如果有\r\n就认为完整
                if (response.includes('\r\n')) {
                    isComplete = true;
                }
            }
            
            // 防止无限循环
            if (responseBuffer.length > 1024) { // SET响应应该很短
                break;
            }
        }
        
        writer.releaseLock();
        reader.releaseLock();
        
        // 解析响应
        if (response.startsWith('+OK')) return 'OK';
        if (response.startsWith('-ERR')) throw new Error(response.substring(1));
        
        console.log(`SET command response: ${response.trim()}`);
        return response.trim();
        
    } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        throw error;
    }
}

// 发送Redis命令
async function sendRedisCommand(socket, command) {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    
    // 构建Redis协议命令
    // 注意：不处理SET命令，SET有专门的函数
    const args = command.split(' ');
    
    let redisCommand = `*${args.length}\r\n`;
    for (const arg of args) {
        redisCommand += `$${arg.length}\r\n${arg}\r\n`;
    }
    
    // 发送命令
    await writer.write(new TextEncoder().encode(redisCommand));
    
    // 读取响应 - 修复大数据读取问题
    let responseBuffer = new Uint8Array();
    let response = '';
    let expectedLength = null;
    let isComplete = false;
    
    try {
        while (!isComplete) {
            const { value, done } = await reader.read();
            
            if (done) {
                break;
            }
            
            // 拼接数据
            const newBuffer = new Uint8Array(responseBuffer.length + value.length);
            newBuffer.set(responseBuffer);
            newBuffer.set(value, responseBuffer.length);
            responseBuffer = newBuffer;
            
            // 转换为字符串进行分析
            response = new TextDecoder().decode(responseBuffer);
            
            // 检查响应是否完整
            if (response.startsWith('$')) {
                // 这是一个批量字符串响应
                const firstCrLf = response.indexOf('\r\n');
                if (firstCrLf > 0) {
                    expectedLength = parseInt(response.substring(1, firstCrLf));
                    
                    if (expectedLength === -1) {
                        // nil响应
                        isComplete = true;
                    } else {
                        // 检查是否已接收完整数据
                        // 格式: $length\r\n + data + \r\n
                        const dataStart = firstCrLf + 2;
                        const expectedEnd = dataStart + expectedLength + 2; // +2 for final \r\n
                        
                        if (responseBuffer.length >= expectedEnd) {
                            isComplete = true;
                        }
                    }
                }
            } else if (response.startsWith('+') || response.startsWith('-') || response.startsWith(':')) {
                // 简单响应，检查是否有\r\n结尾
                if (response.includes('\r\n')) {
                    isComplete = true;
                }
            } else {
                // 其他情况，如果有\r\n就认为完整
                if (response.includes('\r\n')) {
                    isComplete = true;
                }
            }
            
            // 防止无限循环的安全措施
            if (responseBuffer.length > 50 * 1024 * 1024) { // 50MB限制
                console.warn('Redis response too large, breaking');
                break;
            }
        }
    } catch (readError) {
        console.error('Error reading Redis response:', readError);
        throw readError;
    } finally {
        writer.releaseLock();
        reader.releaseLock();
    }
    
    return parseRedisResponse(response);
}

// 解析Redis响应
function parseRedisResponse(response) {
    if (response.startsWith('+OK')) return 'OK';
    if (response.startsWith('+PONG')) return 'PONG';
    if (response.startsWith('-ERR')) throw new Error(response.substring(1));
    if (response.startsWith('$-1')) return null; // nil
    if (response.startsWith('$')) {
        const firstCrLf = response.indexOf('\r\n');
        if (firstCrLf > 0) {
            const length = parseInt(response.substring(1, firstCrLf));
            if (length === -1) return null; // nil
            
            const dataStart = firstCrLf + 2;
            const data = response.substring(dataStart, dataStart + length);
            
            // 验证数据长度是否正确
            if (data.length !== length) {
                console.warn(`Expected ${length} bytes but got ${data.length} bytes`);
                return data; // 返回可用的数据，即使不完整
            }
            
            return data;
        }
        // 旧的回退逻辑
        const lines = response.split('\r\n');
        return lines[1] || null;
    }
    if (response.startsWith(':')) return parseInt(response.substring(1));
    return response.trim();
}

// TCP Redis获取值
async function getTcpRedisValue(redisUrl, key, password = null) {
    let socket = null;
    try {
        socket = await connectToRedis(redisUrl);
        
        // 如果有密码，先认证
        if (password) {
            await sendRedisCommand(socket, `AUTH ${password}`);
        }
        
        // 获取值
        const result = await sendRedisCommand(socket, `GET ${key}`);
        return result;
    } catch (error) {
        console.error('TCP Redis GET error:', error);
        throw error;
    } finally {
        if (socket) {
            try {
                await socket.close();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
        }
    }
}

// TCP Redis设置值
async function setTcpRedisValue(redisUrl, key, value, password = null) {
    let socket = null;
    try {
        socket = await connectToRedis(redisUrl);
        
        // 如果有密码，先认证
        if (password) {
            await sendRedisCommand(socket, `AUTH ${password}`);
        }
        
        // 设置值 - 根据key类型决定如何处理值
        let valueToStore;
        if (key === 'admin:config') {
            // admin:config - 如果已经是字符串就直接使用，否则序列化
            valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
        } else {
            // 其他键（如用户密码）直接存储字符串
            valueToStore = value.toString();
        }
        
        // 使用专门的函数发送SET命令，支持大数据
        const result = await sendRedisSetCommand(socket, key, valueToStore);
        return result;
    } catch (error) {
        console.error('TCP Redis SET error:', error);
        throw error;
    } finally {
        if (socket) {
            try {
                await socket.close();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
        }
    }
}

// TCP Redis ping测试
async function pingTcpRedis(redisUrl, password = null) {
    let socket = null;
    try {
        socket = await connectToRedis(redisUrl);
        
        // 如果有密码，先认证
        if (password) {
            await sendRedisCommand(socket, `AUTH ${password}`);
        }
        
        // 发送ping命令
        const result = await sendRedisCommand(socket, 'PING');
        return result === 'PONG';
    } catch (error) {
        console.error('TCP Redis PING error:', error);
        return false;
    } finally {
        if (socket) {
            try {
                await socket.close();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
        }
    }
}

// 从Redis获取值
async function getRedisValue(redisRestUrl, redisRestToken, key, redisType = 'rest_api') {
    try {
        if (redisType === 'tcp_redis') {
            // 使用TCP连接
            const value = await getTcpRedisValue(redisRestUrl, key, redisRestToken);
            return value;
        } else {
            // 使用REST API
            const response = await fetch(`${redisRestUrl}/get/${key}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${redisRestToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Redis GET failed: ${response.status}`);
            }

            const result = await response.json();
            let value = result.result;

            // 根据 key 类型处理返回值
            if (key === 'admin:config') {
                // admin:config 可能是数组格式，取第一个元素
                if (Array.isArray(value)) {
                    value = value[0] || null;
                }
            } else {
                // 其他键（如用户密码）直接返回字符串
                if (Array.isArray(value)) {
                    value = value[0] || null;
                }
            }

            return value;
        }
    } catch (error) {
        console.error('Error getting Redis value:', error);
        return null;
    }
}

// 向Redis设置值
async function setRedisValue(redisRestUrl, redisRestToken, key, value, redisType = 'rest_api') {
    try {
        if (redisType === 'tcp_redis') {
            // 使用TCP连接
            await setTcpRedisValue(redisRestUrl, key, value, redisRestToken);
            return { result: 'OK' };
        } else {
            // 使用REST API
            // 根据 key 类型决定存储方式
            if (key === 'admin:config') {
                // admin:config 使用 JSON 方式存储 - 直接传递值不要包装成数组
                const response = await fetch(`${redisRestUrl}/set/${key}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${redisRestToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: value  // 直接传递 JSON 字符串
                });

                if (!response.ok) {
                    throw new Error(`Redis SET failed: ${response.status}`);
                }

                return await response.json();
            } else {
                // 其他键（如用户密码）使用 TEXT 方式存储
                const response = await fetch(`${redisRestUrl}/set/${key}/${value}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${redisRestToken}`,
                        'Content-Type': 'application/json',
                    }
                });

                if (!response.ok) {
                    throw new Error(`Redis SET failed: ${response.status}`);
                }

                return await response.json();
            }
        }
    } catch (error) {
        console.error('Error setting Redis value:', error);
        throw error;
    }
}

// 将用户添加到admin:config中
async function addUserToConfig(redisRestUrl, redisRestToken, username, redisType = 'rest_api') {
    try {
        // 读取当前的admin:config
        const configData = await getRedisValue(redisRestUrl, redisRestToken, 'admin:config', redisType);

        if (!configData) {
            return { success: false, error: '无法读取admin:config' };
        }

        console.log('Raw configData type:', typeof configData);
        console.log('Raw configData length:', configData?.length || 'N/A');

        let config;
        try {
            // 如果configData已经是对象，直接使用；否则解析JSON
            if (typeof configData === 'object') {
                config = configData;
            } else if (typeof configData === 'string') {
                // 尝试解析JSON，处理可能的转义问题
                let jsonString = configData.trim();
                
                console.log('Original jsonString length:', jsonString.length);
                console.log('First 200 chars:', jsonString.substring(0, 200));
                console.log('Around position 3825:', jsonString.substring(3820, 3830));
                
                // 如果字符串以引号开头和结尾，去除外层引号
                if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
                    jsonString = jsonString.slice(1, -1);
                    // 解码转义字符
                    jsonString = jsonString.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    console.log('After unescaping, length:', jsonString.length);
                }
                
                // 尝试修复常见的JSON格式问题
                try {
                    config = JSON.parse(jsonString);
                } catch (firstParseError) {
                    console.log('First parse failed, trying to fix JSON...');
                    
                    // 尝试修复未终止的字符串问题
                    let fixedJson = jsonString;
                    
                    // 检查并修复可能的转义问题
                    // 查找问题位置周围的内容
                    const problemPos = 3825;
                    if (problemPos < jsonString.length) {
                        const beforeProblem = jsonString.substring(Math.max(0, problemPos - 50), problemPos);
                        const atProblem = jsonString.substring(problemPos, Math.min(jsonString.length, problemPos + 50));
                        console.log('Before problem:', beforeProblem);
                        console.log('At problem:', atProblem);
                    }
                    
                    // 尝试简单的修复：检查是否有未转义的引号
                    fixedJson = fixedJson.replace(/([^\\])"/g, '$1\\"');
                    
                    try {
                        config = JSON.parse(fixedJson);
                        console.log('Fixed JSON parse successful');
                    } catch (secondParseError) {
                        // 如果还是解析失败，尝试截断到有效的JSON部分
                        console.log('Second parse also failed, trying truncation...');
                        
                        // 从最后一个完整的}开始向前查找
                        let lastValidJson = '';
                        for (let i = jsonString.length - 1; i >= 0; i--) {
                            const testJson = jsonString.substring(0, i);
                            try {
                                const testParse = JSON.parse(testJson);
                                lastValidJson = testJson;
                                config = testParse;
                                console.log('Found valid JSON at position:', i);
                                break;
                            } catch (e) {
                                // 继续尝试更短的字符串
                            }
                        }
                        
                        if (!config) {
                            throw firstParseError; // 抛出原始错误
                        }
                    }
                }
            } else {
                throw new Error('配置数据格式不正确');
            }
        } catch (parseError) {
            console.error('All parse attempts failed:', parseError.message);
            console.error('ConfigData length:', configData?.length);
            return { success: false, error: `配置数据解析失败: ${parseError.message}` };
        }

        // 确保UserConfig和Users数组存在
        if (!config.UserConfig) {
            config.UserConfig = { AllowRegister: false, Users: [] };
        }
        if (!config.UserConfig.Users) {
            config.UserConfig.Users = [];
        }

        // 检查用户是否已经存在
        const userExists = config.UserConfig.Users.some(user => user.username === username);
        if (userExists) {
            return { success: true, message: '用户已存在于配置中' };
        }

        // 添加新用户
        config.UserConfig.Users.push({
            username: username,
            role: "user"
        });

        // 将更新后的配置写回Redis
        const configString = JSON.stringify(config);
        console.log('Writing config string length:', configString.length);
        console.log('Config UserConfig.Users count:', config.UserConfig.Users.length);
        
        await setRedisValue(redisRestUrl, redisRestToken, 'admin:config', configString, redisType);

        return { success: true, message: '用户已添加到配置中' };

    } catch (error) {
        console.error('Error adding user to config:', error);
        return { success: false, error: error.message };
    }
}