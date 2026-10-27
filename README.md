# 风鸟企业查询 · DSH 插件

把 Claude Code 的 `china-company-search-fengniao` skill 移植成 DeepSeek Harness（DSH）Host 插件：

- 原生注册两个 Agent 工具（不再需要 `node scripts/tool.mjs` 命令行）：
  - `fengniao_search_company` — 中文企业名称模糊搜索，返回候选企业的工商全称与 `entid`（接口返回经营状态时一并给出）
  - `fengniao_company_dimension` — 按 `entid` 查询 11 个企业维度，输出上游原始数据（JSON 代码块）
- API Key 在 **DSH「插件」页 → 本插件详情页** 的配置卡片里填写（和官方"思考过程机器翻译"插件同一套 `plugins.bundle.config` 机制），保存在本机 Harness 凭据库，不回显、不写入 profile 配置文件，保存后立即生效。
- 也可用环境变量 `FN_API_KEY` 或 profile `cordis.patch.yml` 里的 `config.apiKey`。

## 安装

这是一个 DSH profile bundle，安装后 Host 半注册工具、Client 半在「插件」页提供配置卡片：

1. 让 DSH 的 plugin manager 把本目录作为 bundle 安装（`install_bundle`，target 传本目录绝对路径）；
2. 安装后无需重启即可生效（Host 行与 Client 模块会热加载）；
3. 打开「插件」页 → 本插件详情 → 在配置卡片里保存 API Key。

也可把目录作为 link 依赖写进 profile 的 `package.json` 并加入 `dsh.profile.bundles`，启动时随 profile 加载。

## 支持的维度

| dimension | 名称 | 上游 version |
| --- | --- | --- |
| `basic_info` | 企业基本信息 | B1 |
| `shareholders` | 企业股东信息 | B2 |
| `executives` | 企业高级职员 | B3 |
| `investments` | 企业对外投资 | B4 |
| `changes` | 企业工商变更 | B5 |
| `executed` | 被执行人 | C2 |
| `dishonest` | 失信被执行人 | C3 |
| `limit_consumption` | 限制高消费 | C4 |
| `abnormal_operation` | 经营异常 | D1 |
| `serious_illegal` | 严重违法 | D2 |
| `admin_penalty` | 行政处罚 | D11 |

## 获取 API Key

登录风鸟 Web 端，在「账户设置 → API Key」生成个人 API Key（完整 Key 只展示一次）。
多个 Key 共用同一账号的每日额度，创建多个 Key 不会增加可用次数；额度以风鸟 API Key 页面展示为准。

## 配置项（全部可选，代码内有默认值）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `apiKey` | 空 | 直接写入的 Key，优先级最高；建议用插件页或凭据库 |
| `credentialRef` | `FENGNIAO_API_KEY` | Harness 凭据库引用名（插件页保存的位置） |
| `apiKeyEnv` | `FN_API_KEY` | 环境变量名回退 |
| `baseUrl` | `https://m.riskbird.com/prod-qbb-api` | 接口地址，内部联调才需要改 |
| `timeoutMs` | `30000` | 单次接口超时（毫秒，5000–120000） |

## 使用方式

直接自然语言提问即可，例如：

- "帮我查一下比亚迪的企业尽调和风险"
- "信数科技的法人是谁、股东有哪些"
- "这家供应商有没有被执行/失信记录"

Agent 会先调用 `fengniao_search_company` 解析主体拿到 `entid`，再按需调用 `fengniao_company_dimension`。名称有歧义时会先向你确认主体。

## 错误码

- `code=9999` 且提示 apikey 不合法/未配置 → 到插件页重新保存 Key
- `code=9999` 且提示访问已达上限 → 账号当日额度用完，隔天再试
- `code=8888` → entid 或参数错误，重新搜索企业
- `code=20000` → 该维度无记录

## 文件结构

```
index.js           Host 半：工具注册 + 上游 HTTP + 同源配置路由 + 凭据读写
client.js          Client 半：插件页内的 API Key 配置卡片
cordis.patch.yml   bundle 清单（插入 fengniao-company-search 行）
locale/*.json      插件页展示的标题与描述
icon.svg           插件图标
```

## 安全边界

- 只从配置 / Harness 凭据库 / 环境变量读取 Key，不读取其他插件或用户目录里的配置
- Key 仅通过上游要求的 `apikey` URL 查询参数发送；不写入日志、不回显给页面
- 配置路由只注册在 DSH 本机 Web 服务上（同源），并要求自定义请求头 `x-fengniao-plugin: 1`：跨站页面无法在不触发 CORS 预检的情况下伪造，避免任意网页 CSRF 改写 Key
