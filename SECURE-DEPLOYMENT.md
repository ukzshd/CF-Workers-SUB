# 安全后台部署

管理入口为 `/admin`，节点接口为 `/admin/api/links`。旧 TOKEN 路径和查询参数继续用于只读订阅，不能修改 KV。不再使用 User-Agent 判断管理权限。外部转换后端、分流模板及各客户端格式保持兼容。

## 构建与预览

1. 本地 Node 22+：`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test`。
2. Pages 项目的构建命令设为 `corepack pnpm install --frozen-lockfile && corepack pnpm build`，构建输出目录设为 `dist`。提交了 pnpm 锁文件，Pages 应安装依赖后执行构建。运行时兼容日期保持现有设置。
3. 现有 `wrangler.toml` 是旧版独立 Workers 配置，不用于 Pages。本版本以控制台管理 Pages 变量和绑定。不要把 Git 仓库根目录作为静态输出目录；只发布包含打包后 `_worker.js` 的 `dist`。
4. 预览环境单独创建测试 KV，并绑定为 `KV`；不要绑定生产 KV。设置测试 `TOKEN`，使用合成节点测试，不复制正式节点。
5. 在分支预览上验证后再合并 main。生产仍使用原来的 KV，原 `LINK.txt` 不迁移、不清空。兼容读取旧 `/LINK.txt`，首次管理保存写入 `LINK.txt`。

## 独立登录（上线前必须完成）

在 Cloudflare Zero Trust 中创建 Self-hosted Access 应用，保护 `sub.nvidias.top/admin` 及其子路径。只允许管理员的指定邮箱，使用邮箱验证码或现有身份提供商，建议会话时长 1 小时。订阅路径不要纳入 Access，以免客户端更新失败。

Pages 生产环境设置以下文本变量（它们不是密码）：

| 变量 | 内容 |
|---|---|
| `ADMIN_ACCESS_TEAM_DOMAIN` | `https://你的团队.cloudflareaccess.com` |
| `ADMIN_ACCESS_AUD` | 这个 Access 应用的 Application Audience (AUD) Tag |
| `ADMIN_EMAILS` | 允许管理的邮箱，多个用英文逗号分隔 |

后台在服务端通过 jose 验证 Access JWT 的签名、issuer、audience、有效期，并额外匹配邮箱白名单。不信任单独的 email 请求头。缺少配置、无凭证、伪造或过期凭证时一律返回 403，不显示节点或开放保存。公钥从配置的团队域名获取，支持密钥轮换。

生产默认 `pages.dev` 和每个部署地址同样由代码验证 JWT，不能通过换域名绕过；这些地址没有对应 Access 登录应用时，后台返回 403，请从自定义域登录。预览如需实际登录，配置独立 Access 应用及独立 AUD、邮箱白名单、测试 KV。不要放宽生产 Access 策略来测试。

点击“退出登录”使用 Cloudflare 的 `/cdn-cgi/access/logout`。再次访问后台必须经过 Access；若身份提供商本身仍有会话，可能按该提供商策略自动登录。需要立即吊销现有 Access 会话时在 Zero Trust 管理端操作。

## 网页与数据保护

- KV 数据经 JSON 接口读取后写入 textarea.value，动态标题通过 textContent 设置；不拼接节点到 HTML。
- nonce CSP、no-store、no-referrer、禁止嵌套 iframe，无外部脚本。订阅复制仍支持各客户端，移除了外部二维码库。
- 保存需有效 Access 凭证、同源 Origin、指定请求头及纯文本 Content-Type，限制 256 KiB；未通过格式检查不写 KV。
- 手动保存默认开启，自动保存可选。保存中可继续编辑，状态明确，未保存离开时提醒。
- 检查常见 VLESS、VMess、Trojan、SS、HY2、TUIC 等链接语法；提示行号且不回显密钥。未知协议仅提示，不阻断兼容。语法校验不保证网络可达。
- 不新增历史、来源监控、分组、设备令牌、失败缓存，不修改 Clash 模板。

## 日志边界

应用只记录固定错误类别，不记录请求 URL、请求头、IP、节点、订阅响应或异常对象。上游请求只设置固定 User-Agent，不转发浏览器 Cookie、Authorization 或 Access 凭证。原 Telegram 访问推送停止使用，以免向外部发送完整入口凭证；旧 TGTOKEN/TGID 配置不再生效。

Cloudflare 平台自身的访问日志不受应用日志代码控制。订阅凭证仍在订阅 URL 中；外部转换后端仍能看到需要转换的节点。本改造不声称消除这两类既有信息流。

## 发布与回滚

先确认构建设置、Access 和变量完成，再合并 main 自动发布。上线检查：匿名 GET/POST 后台被拒绝；管理员可读取保存；原 v2rayN、Clash、sing-box 订阅可更新；检查默认域不能绕过。禁止在验证时清空正式 KV。

发布前由管理员导出节点文本并妥善保管，不提交 GitHub。回滚可在 Pages 选择上一部署，但会恢复旧后台权限模型；KV 数据不会随代码回滚。构建设置也需在回滚后保留本版本所需值，以便再次发布。

上游同步工作流没有改动。后续同步上游时需审查安全后台是否仍被保留，不要自动覆盖本地改造。

## 历史部署入口

除了自定义域的 `/admin`，还需保护 `*.你的项目.pages.dev` 的所有路径。旧版本的不可变部署地址可能仍运行旧编辑器并绑定同一 KV，新代码无法修改这些历史部署。当前项目已将历史与预览域统一纳入管理员 Access 策略。自定义域及默认生产域的订阅路径不纳入 Access，继续供客户端更新。

生产构建使用仓库 `.node-version` 指定 Node 22。发布时应确认生产部署显示最新 main 提交；仅 GitHub 合并成功不等于 Cloudflare 已发布。
