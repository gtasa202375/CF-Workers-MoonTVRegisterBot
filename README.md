# MoonTV Register Bot

🤖 基于 Cloudflare Workers 的 MoonTV 用户注册 Telegram 机器人

## 📋 项目简介

这是一个运行在 Cloudflare Workers 平台上的 Telegram 机器人，用于 MoonTV 平台的用户注册管理。机器人支持用户自动注册、密码修改等功能，并通过 Redis 数据库进行数据持久化存储。

## ✨ 功能特性

- 🔐 **用户注册**：群组成员可以通过机器人快速注册账户
- 🔑 **密码管理**：支持用户自定义修改访问密码
- 👥 **群组验证**：确保只有指定群组成员才能使用注册功能
- 💾 **数据持久化**：使用 Redis 数据库存储用户数据
- ⚡ **无服务器部署**：基于 Cloudflare Workers 平台，无需管理服务器
- 🛡️ **安全配置**：支持环境变量配置，保护敏感信息

## 🛠️ 技术栈

- **平台**：Cloudflare Workers
- **语言**：JavaScript (ES6+)
- **数据库**：Redis (Upstash)
- **API**：Telegram Bot API
- **部署工具**：Wrangler CLI

## 🚀 快速开始

### 1. 环境准备

确保你已经安装了 Node.js 和 npm：

```bash
node --version
npm --version
```

### 2. 克隆项目

```bash
git clone https://github.com/cmliu/CF-Workers-MoonTVRegisterBot.git
cd CF-Workers-MoonTVRegisterBot
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置环境变量

在 `wrangler.toml` 文件中配置必要的环境变量：

```toml
[vars]
REDIS_URL = "your-redis-url"
BOT_TOKEN = "your-telegram-bot-token"
TOKEN = "your-webhook-token"
GROUP_ID = "your-telegram-group-id"
```

### 5. 部署到 Cloudflare Workers

```bash
npm run deploy
```

### 6. 初始化机器人

⚠️ **重要步骤**：部署完成后，必须访问以下 URL 来初始化机器人的 Webhook：

```url
https://your-worker-name.your-subdomain.workers.dev/your-token
```

其中：
- `your-worker-name` 是你的 Worker 名称（在 `wrangler.toml` 中的 `name` 字段）
- `your-subdomain.workers` 是你的 Cloudflare 子域名
- `your-token` 是你在环境变量中设置的 `TOKEN` 值

访问成功后，你将看到类似以下的 JSON 响应：
```json
{
  "webhook": {
    "ok": true,
    "result": true,
    "description": "Webhook was set"
  },
  "commands": {
    "ok": true,
    "result": true,
    "description": "Commands were set"
  },
  "message": "Bot initialized successfully"
}
```

🎉 初始化完成后，机器人就可以正常接收和处理 Telegram 消息了！

## 🔧 配置说明

### 环境变量

| 变量名 | 描述 | 必需 | 示例值 |
|--------|------|------|--------|
| `BOT_TOKEN` | Telegram Bot Token | ✅ | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `GROUP_ID` | Telegram 群组 ID，用于鉴权，仅允许群组成员注册 | ✅ | `-1001234567890` |
| `REDIS_URL` | Redis 连接 URL | ✅ | `rediss://user:pass@host:6379` |
| `TOKEN` | Webhook 初始化令牌 | ✅ | `your-secret-token` |

### Telegram Bot 设置

1. 通过 [@BotFather](https://t.me/botfather) 创建新的 Telegram Bot
2. 获取 Bot Token
3. 将机器人添加到目标群组
4. 获取群组 ID

## 🤖 机器人命令

| 命令 | 功能 | 用法示例 |
|------|------|----------|
| `/start` | 注册新用户或查看用户信息 | `/start` |
| `/pwd` | 修改访问密码 | `/pwd 新密码` |

## 📱 使用流程

> 📌 **前置条件**：确保已完成部署并访问初始化 URL 来设置机器人 Webhook

1. **加入群组**：用户必须先加入指定的 Telegram 群组
2. **开始注册**：向机器人发送 `/start` 命令
3. **自动创建账户**：系统自动创建用户账户，初始密码为用户 ID
4. **修改密码**（可选）：使用 `/pwd 新密码` 命令修改密码

## 🏗️ 项目结构

```
CF-Workers-MoonTVRegisterBot/
├── _worker.js          # 主要的 Worker 代码
├── package.json        # 项目配置文件
├── wrangler.toml      # Cloudflare Workers 配置
├── README.md          # 项目文档
└── .gitignore         # Git 忽略文件
```

## 🔧 开发指南

### 本地开发

```bash
# 启动本地开发服务器
npm run dev
```

### 预览部署

```bash
# 预览部署效果
npm run preview
```

### 完整部署

```bash
# 部署到生产环境
npm run deploy
```

## 📋 数据结构

### Redis 数据格式

- **用户密码**：`u:{userId}:pwd` → 用户密码
- **管理配置**：`admin:config` → JSON 格式的配置信息

### 配置数据结构

```json
{
  "UserConfig": {
    "AllowRegister": false,
    "Users": [
      {
        "username": "123456789",
        "role": "user"
      }
    ]
  }
}
```

## ⚠️ 注意事项

1. **安全性**：请确保 Redis 连接使用加密连接（rediss://）
2. **权限控制**：机器人只允许指定群组的成员使用
3. **密码强度**：密码长度至少为 6 位字符
4. **错误处理**：所有 API 调用都包含错误处理机制

## 🐛 故障排除

### 常见问题

1. **部署失败**：检查 `wrangler.toml` 配置格式是否正确
2. **机器人无响应**：
   - 确认 Bot Token 和 Webhook 配置正确
   - **重要**：检查是否已访问初始化 URL 设置 Webhook
   - 验证机器人是否已添加到指定群组
3. **数据库连接失败**：检查 Redis URL 和认证信息
4. **初始化失败**：确认 TOKEN 参数正确且与访问的 URL 匹配

### 错误码说明

- `500`：服务器内部错误
- `403`：权限不足（用户不在指定群组）
- `400`：请求参数错误

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 👨‍💻 作者

- [@cmliu](https://github.com/cmliu)

## 🙏 致谢
- [MoonTV](https://github.com/MoonTechLab/LunaTV)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

如有问题或建议，请通过 [Issues](https://github.com/cmliu/CF-Workers-MoonTVRegisterBot/issues) 联系我们。
