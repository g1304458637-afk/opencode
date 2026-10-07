# HUBU 2.1.11 独立技能目录部署交接

本目录是部署模板，不代表线上服务已经部署。目录服务仅读取和打包技能文件，不执行技能；用户在客户端选用后，由 HUBU 模型执行原始技能指令。中文翻译使用 HUBU 模型，不由目录服务处理。

## 服务边界

- 独立账号 `hubu-skills`，程序目录 `/srv/hubu-skill-registry/releases/<revision>`，数据目录 `/srv/hubu-skill-registry/data`；不共享 KCode 缓存或凭据。
- 监听 `127.0.0.1:4492`，Nginx HTTPS 路径 `/hubu-skills/` 转发并去掉前缀；不要直接暴露端口。
- `HUBU_SKILL_UPSTREAM_REPOSITORIES` 是逗号分隔的 `owner/repository` 白名单。模板默认为空，须由部署人员填写允许的来源；配置白名单不会自动下载或索引全部技能。
- 目录接口默认公开，无学校账号鉴权。只配置可公开分发的技能来源；不要使用包含私有仓库权限的凭据。
- 服务器凭据 `HUBU_SKILL_GITHUB_TOKEN` 仅放在 `/etc/hubu-skill-registry.env`，不进入桌面应用、构建参数、代码、日志或发布产物。

## 构建与安装

在经验证的 HUBU 提交和目标 Linux 架构上构建，使用仓库指定的 Bun 版本。下面以 Linux x64 为例；arm64 使用 `bun-linux-arm64`。操作前确认端口、目录与现有服务不冲突。

```sh
bun install --frozen-lockfile
bun build --compile --target=bun-linux-x64 packages/core/script/skill-registry.ts --outfile ./hubu-skill-registry
sha256sum ./hubu-skill-registry
```

将该程序和本目录配置交给服务器管理员。首次安装时创建独立的无登录服务账号、数据目录和版本目录；每次升级都创建新的版本目录，保留前一版。程序归 root 所有，服务账号只对 data 目录有写权限。将 `current` 符号链接指向本次已验证的版本目录。

```sh
sudo useradd --system --user-group --home-dir /srv/hubu-skill-registry --shell /usr/sbin/nologin hubu-skills
sudo install -d -o root -g hubu-skills -m 0750 /srv/hubu-skill-registry /srv/hubu-skill-registry/releases
sudo install -d -o hubu-skills -g hubu-skills -m 0750 /srv/hubu-skill-registry/data
sudo install -o root -g hubu-skills -m 0640 hubu-skill-registry.env.example /etc/hubu-skill-registry.env
sudoedit /etc/hubu-skill-registry.env
```

上面创建账号和环境文件的命令仅用于首次安装；升级时保留现有配置和数据。需要认证时，使用独立服务账号的只读 GitHub 令牌。没有令牌也能启动，但会受 GitHub 匿名配额限制；限流时接口返回 `503` 与 `Retry-After`。

将 `hubu-skill-registry.service` 安装到 `/etc/systemd/system/`，确认 `current/hubu-skill-registry` 已存在且可执行后启动：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now hubu-skill-registry.service
sudo systemctl status hubu-skill-registry.service --no-pager
curl --fail http://127.0.0.1:4492/v1/skills
```

将 `hubu-skills.limits.conf` 放进 Nginx 的 `http` 上下文，将 `hubu-skills.location.conf` 放进 HUBU 的 HTTPS `server` 上下文。保留原网关和下载路由。执行 `nginx -t` 成功后 reload。

## 接口验证与目录初始化

使用真实 HTTPS 域名替换下列示例地址。该地址拟定为 `https://hubu.wuxuexi.top/hubu-skills/`，须部署通过后再写入正式客户端构建配置。

| 请求                                                                   | 验收                                      |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| `GET /v1/skills?q=关键词`                                              | 返回已解析入库的技能；初始空目录返回 `[]` |
| `POST /v1/discover`，JSON `{"url":"已允许的 GitHub 仓库或子目录 URL"}` | 列出该来源的候选技能                      |
| `POST /v1/resolve`，JSON `{"url":"已发现技能的具体 GitHub URL"}`       | 校验技能、写入缓存并返回版本及下载信息    |
| `GET /v1/skills/<id>/revisions/<revision>`                             | 返回不可变版本清单                        |
| `GET /v1/artifacts/<hash>.zip`                                         | 返回对应下载包；客户端校验内容与哈希      |

部署人员应先对允许的来源执行发现和解析，为搜索目录填充技能。确认 HTTPS 前缀下的列表、发现、解析、版本清单和 ZIP 均可访问，且未允许来源被拒绝。验证令牌不出现在响应与日志中。

## 客户端配置与发布验收

- 正式 HUBU 构建必须显式提供 `HUBU_SKILL_REGISTRY_URL=https://实际域名/hubu-skills/`。该变量只包含公开目录地址，不包含 token、账号、查询参数或片段。
- 原 `HUBU_GATEWAY_URL`、更新清单、更新源、下载页和数据命名空间保持原配置；不得将目录地址用作模型网关。
- 本地测试用 `CAMPUS_LOCAL_BUILD=1` 与 `HUBU_SKILL_REGISTRY_URL=http://127.0.0.1:4492/`。未配置目录时本地和已安装技能仍可用，在线功能提示未配置；HUBU 不自动回退 KCode 或直接访问 GitHub。
- 线上服务部署后，再用隔离的 HUBU 测试账号验收搜索、安装、翻译、任务选用、执行、重启、卸载和断网提示，记录具体服务版本及客户端提交。
- 确认目录恢复后可重试、旧版数据升级正常，再单独执行线上客户端发布；本次代码交付不覆盖旧安装包或更新清单。

## 运维与回滚

检查 `journalctl -u hubu-skill-registry.service`、Nginx 错误日志、磁盘余量、内存和限流状态。至少留出 512 MiB 可用空间用于新技能发布；下载包与已发布版本应保持持久存储。备份 data 和服务器环境文件时保护凭据权限。

回滚前记录当前 `current` 目标并保存本次程序哈希；将 `current` 切回上一已验证版本，重启该服务并重新执行本机及 HTTPS 接口验收。保留 data 目录、旧技能版本和原客户端安装包，不删除 KCode 或 HUBU 网关数据。Nginx 配置回退同样先执行 `nginx -t`。首次部署失败时停用新服务和本次新增的 Nginx include，恢复原网关配置。

Linux systemd、Nginx 与线上网关联调属于服务器交接验收，不能用本地构建通过替代。

## 本次本地验收记录

2026-10-07 在 Windows 隔离目录完成，未访问真实用户数据、GitHub 技能来源或线上模型：

- `packages/core` 下 `bun test ./test/hubu-skill-registry.integration.test.ts`：3 项通过，34 次断言。真实回环 HTTP 服务验证 `/hubu-skills/` 前缀下的搜索、预览、ZIP 下载、安装和任务引用；关闭目录及数据库后重开，已安装技能和资源仍可读取，未配置目录的在线查询明确失败，本地 ZIP 仍可安装和卸载。实际组装的后端服务仅读取 HUBU 目录地址，即使存在 KCode 目录及直接回退环境变量也不会采用。
- 使用全部旧迁移构造包含项目、会话、消息及模型设置的数据库，再复制该文件升级：原有记录完整保留，新增 6 张技能表，二次启动保留技能选择；原数据库逐字节未变。
- 原生 `bun build --compile packages/core/script/skill-registry.ts` 编译成功；使用独立数据目录启动编译产物，日志身份为 `HUBU AI`，本机列表返回 `200 []`，不在白名单的技能来源返回 `400`。测试进程已关闭。
- 桌面构建配置和安装包身份测试 26 项通过，品牌测试 7 项通过；确认生产目录地址必须明确配置、不可带凭据或查询参数，其他品牌不采用 HUBU 目录。

Linux 编译产物、systemd 限制、Nginx HTTPS 转发、真实来源下载、模型翻译及真实账户执行仍需按上述服务器交接流程验收。
