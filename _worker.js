// 获取Cookie函数
async function getCookie(moontvUrl, username, password, KV) {
    try {
        // 先检查KV中是否存在cookie
        let cookieData = await KV.get('cookie');
        
        if (cookieData) {
            try {
                // 解析cookie获取timestamp
                const cookieObject = JSON.parse(cookieData);
                const currentTime = Date.now();
                const cookieTime = cookieObject.timestamp;
                
                // 检查是否超过5天 (5 * 24 * 60 * 60 * 1000 = 432000000毫秒)
                if (currentTime - cookieTime < 432000000) {
                    // Cookie未过期，直接使用存储的原始cookie数据进行编码
                    const encodedCookie = encodeURIComponent(encodeURIComponent(cookieData));
                    console.log('使用缓存的Cookie');
                    console.log('缓存的原始Cookie JSON:', cookieData);
                    console.log('Cookie timestamp:', cookieTime, '当前时间:', currentTime, '差值(小时):', (currentTime - cookieTime) / (1000 * 60 * 60));
                    console.log('最终编码的Cookie:', `auth=${encodedCookie}`);
                    return `auth=${encodedCookie}`;
                }
            } catch (parseError) {
                console.log('Cookie解析失败，将重新获取:', parseError.message);
            }
        }
        
        // Cookie不存在或已过期，重新获取
        console.log('正在获取新的Cookie...');
        const loginResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        if (!loginResponse.ok) {
            throw new Error(`登录请求失败: ${loginResponse.status}`);
        }

        const loginResult = await loginResponse.json();
        if (!loginResult.ok) {
            throw new Error('登录失败: 用户名或密码错误');
        }

        // 从响应头中获取Set-Cookie
        const setCookieHeader = loginResponse.headers.get('set-cookie');
        if (!setCookieHeader) {
            throw new Error('未收到Cookie响应');
        }

        console.log('服务器返回的Set-Cookie头:', setCookieHeader);

        // 解析auth cookie
        const authCookieMatch = setCookieHeader.match(/auth=([^;]+)/);
        if (!authCookieMatch) {
            throw new Error('未找到auth cookie');
        }

        const encodedCookieValue = authCookieMatch[1];
        console.log('从Set-Cookie中提取的auth值:', encodedCookieValue);
        
        // 进行两次URL解码获取原始cookie JSON
        const decodedOnce = decodeURIComponent(encodedCookieValue);
        const decodedTwice = decodeURIComponent(decodedOnce);
        console.log('解码后的原始Cookie JSON:', decodedTwice);
        
        // 验证JSON格式
        const cookieObject = JSON.parse(decodedTwice);
        console.log('解析后的Cookie对象:', JSON.stringify(cookieObject));
        console.log('Cookie中的timestamp:', cookieObject.timestamp);
        
        // 直接存储原始cookie JSON字符串，不做任何修改
        await KV.put('cookie', decodedTwice);
        
        // 返回编码后的cookie
        const finalEncodedCookie = encodeURIComponent(encodeURIComponent(decodedTwice));
        console.log('获取并保存了新的Cookie');
        console.log('最终编码的Cookie:', `auth=${finalEncodedCookie}`);
        return `auth=${finalEncodedCookie}`;

    } catch (error) {
        console.error('获取Cookie失败:', error);
        throw error;
    }
}

// 检查用户是否已注册
async function checkUserExists(moontvUrl, username, password, KV, targetUsername) {
    try {
        const cookie = await getCookie(moontvUrl, username, password, KV);
        
        const configResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/admin/config`, {
            method: 'GET',
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT
            }
        });

        if (!configResponse.ok) {
            throw new Error(`获取配置API失败: HTTP ${configResponse.status}`);
        }

        const configResult = await configResponse.json();
        
        if (!configResult.Config || !configResult.Config.UserConfig || !configResult.Config.UserConfig.Users) {
            return false;
        }

        // 检查用户是否存在
        const userExists = configResult.Config.UserConfig.Users.some(user => user.username === targetUsername);
        return userExists;

    } catch (error) {
        console.error('检查用户是否存在失败:', error);
        return false;
    }
}

// MoonTV Register Bot - Cloudflare Worker
// API-based user registration system for MoonTV platform

// User-Agent 标识
const USER_AGENT = "CF-Workers-MoonTVRegisterBot/cmliu";

// 生成初始密码
function generateInitialPassword(userId) {
    const timestamp = Date.now();
    const rawText = `${userId}${timestamp}`;
    return crypto.subtle.digest('MD5', new TextEncoder().encode(rawText))
        .then(hashBuffer => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('').substring(0, 8);
        });
}

export default {
    async fetch(request, env, ctx) {
        const moontvUrl = env.MOONTVURL || "https://cmoontv.dedyn.io/";
        const username = env.USERNAME || "admin";
        const password = env.PASSWORD || "admin_password";
        const token = env.TOKEN || "token";
        const bot_token = env.BOT_TOKEN || "8226743743:AAHfrc09vW8cxKHyU0q0YKPuCXrW1ICWdU0";
        const GROUP_ID = env.GROUP_ID || "-1002563172210";

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
                return await handleCheckEndpoint(moontvUrl, username, password, env.KV);
            } else {
                return new Response("Forbidden", { status: 403 });
            }
        }

        // 处理 Telegram Webhook
        if (request.method === 'POST') {
            return await handleTelegramWebhook(request, bot_token, GROUP_ID, moontvUrl, username, password, env.KV);
        }

        // 默认返回404错误页面（伪装）
        return new Response("Not Found", { status: 404 });
    },
};

// 处理检测端点
async function handleCheckEndpoint(moontvUrl, username, password, KV) {
    const checkResult = {
        timestamp: new Date().toISOString(),
        moontvApi: {
            url: moontvUrl,
            status: 'unknown',
            error: null,
            responseTime: null
        },
        cookieStatus: {
            exists: false,
            valid: false,
            error: null
        },
        configApi: {
            accessible: false,
            userCount: 0,
            error: null
        },
        errors: []
    };

    let startTime = Date.now();

    try {
        // 测试登录API
        console.log('Testing MoonTV API connection...');
        
        const loginResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        checkResult.moontvApi.responseTime = Date.now() - startTime;

        if (!loginResponse.ok) {
            checkResult.moontvApi.status = 'error';
            checkResult.moontvApi.error = `API请求失败: HTTP ${loginResponse.status}`;
            checkResult.errors.push(`MoonTV API连接失败: HTTP ${loginResponse.status}`);
        } else {
            const loginResult = await loginResponse.json();
            
            if (loginResult.ok) {
                checkResult.moontvApi.status = 'connected';
                console.log('MoonTV API连接成功');
                
                // 测试Cookie功能
                try {
                    const cookie = await getCookie(moontvUrl, username, password, KV);
                    checkResult.cookieStatus.exists = true;
                    checkResult.cookieStatus.valid = true;
                    console.log('Cookie获取成功');
                    
                    // 测试配置API
                    try {
                        const cookie = await getCookie(moontvUrl, username, password, KV);
                        console.log('准备调用配置API，使用Cookie:', cookie);
                        
                        const configResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/admin/config`, {
                            method: 'GET',
                            headers: {
                                'Cookie': cookie,
                                'User-Agent': USER_AGENT
                            }
                        });

                        console.log('配置API响应状态:', configResponse.status);
                        console.log('配置API响应头:', Object.fromEntries(configResponse.headers.entries()));

                        if (configResponse.ok) {
                            const configResult = await configResponse.json();
                            checkResult.configApi.accessible = true;
                            
                            if (configResult.Config && configResult.Config.UserConfig && configResult.Config.UserConfig.Users) {
                                checkResult.configApi.userCount = configResult.Config.UserConfig.Users.length;
                                console.log(`配置API访问成功，当前用户数: ${checkResult.configApi.userCount}`);
                            }
                        } else {
                            const errorText = await configResponse.text();
                            console.log('配置API错误响应内容:', errorText);
                            checkResult.configApi.error = `配置API访问失败: HTTP ${configResponse.status}`;
                            checkResult.errors.push(checkResult.configApi.error);
                        }
                    } catch (configError) {
                        checkResult.configApi.error = configError.message;
                        checkResult.errors.push(`配置API测试失败: ${configError.message}`);
                    }
                    
                } catch (cookieError) {
                    checkResult.cookieStatus.error = cookieError.message;
                    checkResult.errors.push(`Cookie获取失败: ${cookieError.message}`);
                }
            } else {
                checkResult.moontvApi.status = 'auth_error';
                checkResult.moontvApi.error = '登录认证失败';
                checkResult.errors.push('用户名或密码错误');
            }
        }

    } catch (networkError) {
        checkResult.moontvApi.status = 'network_error';
        checkResult.moontvApi.responseTime = Date.now() - startTime;
        checkResult.moontvApi.error = networkError.message;
        checkResult.errors.push(`网络错误: ${networkError.message}`);
        
        // 分析可能的网络问题
        if (networkError.message.includes('fetch')) {
            checkResult.errors.push('可能的原因: 1) MoonTV URL配置错误 2) 网络连接问题 3) 服务器不可达');
        }
        if (networkError.message.includes('timeout')) {
            checkResult.errors.push('连接超时，请检查MoonTV服务状态');
        }
    }

    // 添加诊断建议
    const diagnostics = [];
    
    if (checkResult.moontvApi.status === 'error' || checkResult.moontvApi.status === 'network_error') {
        diagnostics.push('请检查MOONTVURL环境变量是否正确配置');
        diagnostics.push('请确认MoonTV服务是否正常运行');
        diagnostics.push('请检查网络连接是否正常');
    }
    
    if (checkResult.moontvApi.status === 'auth_error') {
        diagnostics.push('请检查USERNAME和PASSWORD环境变量是否正确');
        diagnostics.push('请确认用户具有管理员权限');
    }
    
    if (!checkResult.cookieStatus.valid && checkResult.moontvApi.status === 'connected') {
        diagnostics.push('API连接正常但Cookie获取失败，可能存在权限问题');
    }
    
    if (!checkResult.configApi.accessible && checkResult.cookieStatus.valid) {
        diagnostics.push('Cookie获取成功但配置API访问失败，请检查管理员权限');
    }
    
    if (checkResult.moontvApi.responseTime && checkResult.moontvApi.responseTime > 5000) {
        diagnostics.push('API响应时间较长，可能存在网络延迟问题');
    }

    checkResult.diagnostics = diagnostics;
    checkResult.summary = {
        apiOk: checkResult.moontvApi.status === 'connected',
        cookieOk: checkResult.cookieStatus.valid,
        configOk: checkResult.configApi.accessible,
        overallStatus: checkResult.moontvApi.status === 'connected' && 
                      checkResult.cookieStatus.valid && 
                      checkResult.configApi.accessible ? 'healthy' : 'unhealthy'
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
async function handleTelegramWebhook(request, bot_token, GROUP_ID, moontvUrl, username, password, KV) {
    try {
        const update = await request.json();

        if (update.message && update.message.text) {
            const message = update.message;
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text;

            // 处理 /start 命令
            if (text === '/start') {
                return await handleStartCommand(bot_token, userId, chatId, GROUP_ID, moontvUrl, username, password, KV);
            }

            // 处理 /pwd 命令
            if (text.startsWith('/pwd')) {
                if (text === '/pwd' || text.trim() === '/pwd') {
                    // 用户只输入了 /pwd 没有提供密码
                    await sendMessage(bot_token, chatId, "❌ 请输入要修改的新密码\n\n💡 使用方法：/pwd 新密码\n📝 示例：/pwd 12345678\n\n这样就会将密码改为 12345678", moontvUrl);
                    return new Response('OK');
                } else if (text.startsWith('/pwd ')) {
                    const newPassword = text.substring(5).trim();
                    return await handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, moontvUrl, username, password, KV);
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
async function handleStartCommand(bot_token, userId, chatId, GROUP_ID, moontvUrl, username, password, KV) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            await sendMessage(bot_token, chatId, "⚠️ 当前用户无注册权限，请先加入指定群组。", moontvUrl);
            return new Response('OK');
        }

        // 检查用户是否已注册（通过API查询）
        const userExists = await checkUserExists(moontvUrl, username, password, KV, userId.toString());

        let responseMessage;

        if (!userExists) {
            // 用户未注册，创建新账户
            const initialPassword = await generateInitialPassword(userId);
            
            // 获取cookie并调用API添加用户
            try {
                const cookie = await getCookie(moontvUrl, username, password, KV);
                
                const addUserResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/admin/user`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookie,
                        'User-Agent': USER_AGENT
                    },
                    body: JSON.stringify({
                        targetUsername: userId.toString(),
                        targetPassword: initialPassword,
                        action: 'add'
                    })
                });

                if (!addUserResponse.ok) {
                    throw new Error(`添加用户API失败: HTTP ${addUserResponse.status}`);
                }

                const addResult = await addUserResponse.json();
                if (!addResult.ok) {
                    throw new Error('添加用户失败');
                }

                // 将用户信息存储到KV作为备份记录
                await KV.put(`user_${userId}`, JSON.stringify({
                    username: userId.toString(),
                    createdAt: Date.now(),
                    lastPasswordChange: Date.now()
                }));

                responseMessage = `✅ 注册成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 访问密码：<code>${initialPassword}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n⚠️ 请妥善保存密码，忘记密码可通过修改密码命令重置`;
            } catch (apiError) {
                console.error('添加用户API失败:', apiError);
                await sendMessage(bot_token, chatId, `❌ 注册失败: ${apiError.message}\n\n请稍后再试或联系管理员。`, moontvUrl);
                return new Response('OK');
            }
        } else {
            // 用户已存在，显示当前信息
            responseMessage = `ℹ️ 你已注册过账户\n\n🆔 用户名：<code>${userId}</code>\n\n💡 使用 <code>/pwd 新密码</code> 可以修改密码\n\n⚠️ 如忘记密码，可直接通过修改密码命令重置`;
        }

        await sendMessage(bot_token, chatId, responseMessage, moontvUrl);
        return new Response('OK');
    } catch (error) {
        console.error('Error in start command:', error);
        await sendMessage(bot_token, chatId, "❌ 操作失败，请稍后再试。", moontvUrl);
        return new Response('OK');
    }
}

// 处理 /pwd 命令
async function handlePasswordCommand(bot_token, userId, chatId, GROUP_ID, newPassword, moontvUrl, username, password, KV) {
    try {
        // 检查用户是否在群组中
        const isInGroup = await checkUserInGroup(bot_token, GROUP_ID, userId);

        if (!isInGroup) {
            await sendMessage(bot_token, chatId, "⚠️ 当前用户无权限，请先加入指定群组。", moontvUrl);
            return new Response('OK');
        }

        if (!newPassword || newPassword.length < 6) {
            await sendMessage(bot_token, chatId, "❌ 密码长度至少6位，请重新输入。\n\n💡 使用方法：/pwd 你的新密码", moontvUrl);
            return new Response('OK');
        }

        // 检查用户是否已注册（通过API查询）
        const userExists = await checkUserExists(moontvUrl, username, password, KV, userId.toString());

        if (!userExists) {
            await sendMessage(bot_token, chatId, "❌ 用户未注册，请先使用 /start 命令注册账户。", moontvUrl);
            return new Response('OK');
        }

        // 调用API修改密码
        try {
            const cookie = await getCookie(moontvUrl, username, password, KV);
            
            const changePasswordResponse = await fetch(`${moontvUrl.replace(/\/$/, '')}/api/admin/user`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookie,
                    'User-Agent': USER_AGENT
                },
                body: JSON.stringify({
                    targetUsername: userId.toString(),
                    targetPassword: newPassword,
                    action: 'changePassword'
                })
            });

            if (!changePasswordResponse.ok) {
                throw new Error(`修改密码API失败: HTTP ${changePasswordResponse.status}`);
            }

            const changeResult = await changePasswordResponse.json();
            if (!changeResult.ok) {
                throw new Error('修改密码失败');
            }

            // 更新KV中的用户信息作为备份记录
            const userKey = `user_${userId}`;
            const existingUserData = await KV.get(userKey);
            let userData = existingUserData ? JSON.parse(existingUserData) : {
                username: userId.toString(),
                createdAt: Date.now()
            };
            userData.lastPasswordChange = Date.now();
            await KV.put(userKey, JSON.stringify(userData));

            await sendMessage(bot_token, chatId, `✅ 密码修改成功！\n\n🆔 用户名：<code>${userId}</code>\n🔑 新密码：<code>${newPassword}</code>\n\n💡 新密码已生效，请妥善保存`, moontvUrl);
            return new Response('OK');
        } catch (apiError) {
            console.error('修改密码API失败:', apiError);
            await sendMessage(bot_token, chatId, `❌ 密码修改失败: ${apiError.message}\n\n请稍后再试或联系管理员。`, moontvUrl);
            return new Response('OK');
        }
    } catch (error) {
        console.error('Error in password command:', error);
        await sendMessage(bot_token, chatId, "❌ 密码修改失败，请稍后再试。", moontvUrl);
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

// 发送消息（带有 MoonTV 链接按钮）
async function sendMessage(bot_token, chatId, text, moontvUrl = null) {
    try {
        const messageData = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        };

        // 如果提供了 moontvUrl，添加内联键盘
        if (moontvUrl) {
            messageData.reply_markup = {
                inline_keyboard: [[
                    {
                        text: "🎬 MoonTV观影站点",
                        url: moontvUrl
                    }
                ]]
            };
        }

        await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify(messageData)
        });
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

