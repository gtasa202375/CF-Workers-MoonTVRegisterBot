# MoonTV Register Bot

🤖 基于 Cloudflare Workers 的 MoonTV 用户注册 Telegram 机器人

## 📋 项目简介

这是一个运行在 Cloudflare Workers 平台上的 Telegram 机器人，用于 MoonTV 平台的用户注册管理。机器人通过 MoonTV API 接口进行用户管理，支持用户自动注册、密码修改等功能，使用 Cloudflare KV 进行数据缓存。

## ✨ 功能特性

- 🔐 **用户注册**：群组成员可以通过机器人快速注册 MoonTV 账户
- 🔑 **密码管理**：支持用户自定义修改访问密码
- 👥 **群组验证**：确保只有指定群组成员才能使用注册功能
- 🌐 **API 集成**：直接调用 MoonTV API 进行用户管理
- ⚡ **无服务器部署**：基于 Cloudflare Workers 平台，无需管理服务器
- 🛡️ **安全配置**：支持环境变量配置，保护敏感信息
- 💾 **智能缓存**：使用 KV 存储 Cookie 缓存，提高响应速度

## 🛠️ 技术栈

- **平台**：Cloudflare Workers
- **语言**：JavaScript (ES6+)
- **存储**：Cloudflare KV (Cookie缓存)
- **API**：Telegram Bot API + MoonTV API
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

在 Cloudflare Workers 控制台中配置以下环境变量：

| 变量名 | 描述 | 必需 | 示例值 |
|--------|------|------|--------|
| `BOT_TOKEN` | Telegram Bot Token | ✅ | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `GROUP_ID` | Telegram 群组 ID，用于鉴权，仅允许群组成员注册 | ✅ | `-1001234567890` |
| `MOONTVURL` | MoonTV 服务地址 | ✅ | `https://moontv.dedyn.io` |
| `USERNAME` | MoonTV 管理员用户名 | ✅ | `admin` |
| `PASSWORD` | MoonTV 管理员密码 | ✅ | `your-admin-password` |
| `TOKEN` | Webhook 初始化令牌 | ✅ | `your-secret-token` |

### 5. 部署到 Cloudflare Workers

```bash
npm run deploy
```

### 6. 初始化机器人

⚠️ **重要步骤**：部署完成后，访问以下 URL 来初始化机器人的 Webhook：

```url
https://your-worker-name.your-subdomain.workers.dev/your-token
```

访问成功后，你将看到初始化成功的 JSON 响应。

## 🤖 机器人命令

| 命令 | 功能 | 用法示例 |
|------|------|----------|
| `/start` | 注册新用户或查看用户信息 | `/start` |
| `/pwd` | 修改访问密码 | `/pwd 新密码` |

## 📱 使用流程

1. **加入群组**：用户必须先加入指定的 Telegram 群组
2. **开始注册**：向机器人发送 `/start` 命令
3. **自动创建账户**：系统通过 MoonTV API 创建用户账户
4. **修改密码**（可选）：使用 `/pwd 新密码` 命令修改密码

## 🔧 监控与检测

访问以下 URL 可以检测服务状态：

```url
https://your-worker-name.your-subdomain.workers.dev/check?token=your-token
```

检测内容包括：
- MoonTV API 连接状态
- Cookie 获取和缓存状态  
- 配置 API 访问权限
- 用户数量统计

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

### 部署

```bash
# 部署到生产环境
npm run deploy
```

## ⚠️ 注意事项

1. **安全性**：请确保 MoonTV 管理员密码安全
2. **权限控制**：机器人只允许指定群组的成员使用
3. **密码强度**：密码长度至少为 6 位字符
4. **Cookie 缓存**：系统自动管理 Cookie 缓存，有效期 5 天

## 🐛 故障排除

### 常见问题

1. **部署失败**：检查 `wrangler.toml` 配置格式
2. **机器人无响应**：确认 Bot Token 和 Webhook 配置正确
3. **API 连接失败**：检查 MoonTV URL 和管理员凭据
4. **权限错误**：确认管理员账户具有足够权限

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

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
