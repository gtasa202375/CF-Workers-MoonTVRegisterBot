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
                return await handleCheckEndpoint(redisRestUrl, redisRestToken);
            } else {
                return new Response("Forbidden", { status: 403 });
            }
        }

        // 处理 Telegram Webhook
        if (request.method === 'POST') {
            return await handleTelegramWebhook(request, bot_token, GROUP_ID, redisRestUrl, redisRestToken);
        }

        // 默认返回404错误页面（伪装）
        return new Response("Not Found", { status: 404 });
    },
};

// 处理检测端点
async function handleCheckEndpoint(redisRestUrl, redisRestToken) {
    const checkResult = {
        timestamp: new Date().toISOString(),
        redisConnection: {
            url: redisRestUrl,
            status: 'unknown',
            error: null,
            responseTime: null
        },
        adminConfig: null,
        errors: []
    };

    let startTime = Date.now();

    try {
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
                const configData = await getRedisValue(redisRestUrl, redisRestToken, 'admin:config');
                
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
        diagnostics.push('请检查REDIS_URL环境变量是否正确配置');
        diagnostics.push('请确认Redis服务是否正常运行');
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
async function handleTelegramWebhook(request, bot_token, GROUP_ID, redisRestUrl, redisRestToken) {
    try {
        const update = await request.json();

        if (update.message && update.message.text) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;

            // 处理 /start 命令
            if (text === '/start') {
                return await handleStartCommand(bot_token, userId, chatId, GROUP_ID, redisRestUrl, redisRestToken);
            }

            // 处理 /pwd 命令
            if (text.startsWith('/pwd')) {
                if (text === '/pwd' || text.trim() === '/pwd') {
                    // 用户只输入了 /pwd 没有提供密码
                    await sendMessage(bot_token, chatId, "❌ 请输入要修改的新密码\n\n💡 使用方法：/pwd 新密码\n📝 示例：/pwd 12345678\n\n这样就会将密码改为 12345678");
                    return new Response('OK');
                } else if (text.startsWith('/pwd ')) {
                    const newPassword = text.substring(5).trim();
                    return await handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, redisRestUrl, redisRestToken);
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
async function handleStartCommand(bot_token, userId, chatId, GROUP_ID, redisRestUrl, redisRestToken) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            await sendMessage(bot_token, chatId, "⚠️ 当前用户无注册权限，请先加入指定群组。");
            return new Response('OK');
        }

        // 检查用户是否已注册
        const userKey = `u:${userId}:pwd`;
        const existingUser = await getRedisValue(redisRestUrl, redisRestToken, userKey);

        let responseMessage;

        if (existingUser === null) {
            // 用户未注册，创建新账户
            const initialPassword = await generateInitialPassword(userId);
            await setRedisValue(redisRestUrl, redisRestToken, userKey, initialPassword);

            // 将用户添加到admin:config中
            const configUpdateResult = await addUserToConfig(redisRestUrl, redisRestToken, userId.toString());

            if (configUpdateResult.success) {
                responseMessage = `✅ 注册成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码`;
            } else {
                responseMessage = `⚠️ 账户创建成功，但配置更新失败\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n❌ 错误信息：${configUpdateResult.error}`;
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
async function handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, redisRestUrl, redisRestToken) {
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
        const existingUser = await getRedisValue(redisRestUrl, redisRestToken, userKey);

        if (existingUser === null) {
            await sendMessage(bot_token, chatId, "❌ 用户未注册，请先使用 /start 命令注册账户。");
            return new Response('OK');
        }

        // 更新密码
        await setRedisValue(redisRestUrl, redisRestToken, userKey, newPassword);

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

// 从Redis获取值
async function getRedisValue(redisRestUrl, redisRestToken, key) {
    try {
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
    } catch (error) {
        console.error('Error getting Redis value:', error);
        return null;
    }
}

// 向Redis设置值
async function setRedisValue(redisRestUrl, redisRestToken, key, value) {
    try {
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
    } catch (error) {
        console.error('Error setting Redis value:', error);
        throw error;
    }
}

// 将用户添加到admin:config中
async function addUserToConfig(redisRestUrl, redisRestToken, username) {
    try {
        // 读取当前的admin:config
        const configData = await getRedisValue(redisRestUrl, redisRestToken, 'admin:config');

        if (!configData) {
            return { success: false, error: '无法读取admin:config' };
        }

        let config;
        try {
            config = JSON.parse(configData);
        } catch (parseError) {
            return { success: false, error: '配置数据解析失败' };
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
        await setRedisValue(redisRestUrl, redisRestToken, 'admin:config', configString);

        return { success: true, message: '用户已添加到配置中' };

    } catch (error) {
        console.error('Error adding user to config:', error);
        return { success: false, error: error.message };
    }
}