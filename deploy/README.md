# VPS 部署

Pages 入口与原订阅转换逻辑继续保留。VPS 使用 Node.js 24 LTS、SQLite 和 systemd，构建命令为 `pnpm build:vps`，部署产物为 `dist-vps/server.mjs`。

将官方 Node.js Linux x64 运行时放入 `/opt/cf-workers-sub/runtime/`，先核对官方 SHASUMS256。应用文件位于 `/opt/cf-workers-sub/server.mjs`，systemd 单元使用本目录的 `cf-workers-sub.service`。无需安装全局 Node.js 或容器。

`/etc/cf-workers-sub.env` 归 root 所有、权限 0600，配置如下，各值使用 JSON 双引号字符串：

```ini
TOKEN="替换为现有订阅令牌"
SUBCONFIG="现有转换规则地址"
ADMIN_ACCESS_TEAM_DOMAIN="https://你的团队.cloudflareaccess.com"
ADMIN_ACCESS_AUD="Access 应用 AUD"
ADMIN_EMAILS="允许登录的邮箱"
PUBLIC_ORIGIN=""
INITIAL_LINKS_BASE64="原编辑器文本的 UTF-8 Base64"
```

`INITIAL_LINKS_BASE64` 仅在数据库尚无节点记录时导入，不覆盖后续保存的内容或空列表。数据库位于 `/var/lib/cf-workers-sub/nodes.sqlite`；备份应使用 SQLite online backup，或停止服务后完整复制数据库及其 WAL，恢复时保持目录权限 0700、文件 0600。凭证与备份均不得进入公开仓库。

初始阶段仅监听 `127.0.0.1:3080`，`PUBLIC_ORIGIN` 留空，不开放公网。先通过 `node deploy/verify.mjs` 验证健康、订阅和拒绝未登录写入；可在末尾传入迁移前订阅的 SHA256，验证字节完全一致。

域名确定后，将 `PUBLIC_ORIGIN` 设置为准确的 HTTPS origin，配置反向代理和 TLS，保留原 Host，并转发 `Cf-Access-Jwt-Assertion`。在 Cloudflare Access 中仅保护该域名 `/admin` 及子路径，并把 AUD 配置同步到应用；订阅路径不要求登录。源站会验证 Access 签名、签发者、受众和邮箱，因此直接连接源站或伪造请求头也不能访问后台。订阅响应禁止缓存，反向代理不要记录带令牌的路径。CDN 使用 Full (strict)，勿缓存订阅与管理路径。

使用配置事务先校验 `node --check` 与 `systemd-analyze verify`，再重启服务并运行验证脚本；失败恢复旧应用、环境文件及单元并重启。新安装回退可停用该服务，保留数据库。域名接入前不得将本机端口改为公网监听。

## HTTPS 入口

本目录 `nginx.conf` 与 `cf-workers-sub-nginx.service` 给出独立 nginx 实例，配置安装至 `/opt/cf-workers-sub/nginx.conf`，不会加载系统 nginx 的其他站点。示例域名为 `sub.nvidias.top`，换域名时同步修改 nginx、`PUBLIC_ORIGIN` 与 Access 应用。80 端口仅提供 ACME 验证和 HTTPS 跳转；443 仅接受正确 SNI，根路径跳转 `/admin`。不记录访问路径，错误日志不写请求内容。

证书文件为 `/etc/cf-workers-sub/tls/fullchain.pem`、`key.pem`，目录 0700、文件 0600。ACME webroot `/var/lib/cf-workers-sub-acme/.well-known/acme-challenge` 的各级目录需 0755，验证文件需允许 nginx 读取；仅存放公开的证书验证材料。先用临时 HTTP 配置签发证书，再事务切换完整 HTTPS 配置。acme.sh 使用现有续期 cron，`--install-cert` 的 reloadcmd 设为 `systemctl reload cf-workers-sub-nginx.service`。

从 Pages 迁出时，DNS 改为 VPS 的 A 记录后，解除 Pages 的旧自定义域绑定并确认 A 记录仍在。公网验证应包含 HTTPS 健康检查、订阅 SHA256、禁止缓存、匿名后台跳转 Access，以及直接访问源站后台返回 403。真实邮箱登录后的读取与保存由已登录浏览器验证，不能用匿名请求替代。
