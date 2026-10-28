# 风鸟企业查询 · DSH 插件

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c6ef5?style=flat-square)](#)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-5b6bff?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/version-1.0.1-blue?style=flat-square)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.3%2B-4D6BFE?style=flat-square)](#兼容性)

**标签**：`dsh-plugin` · `dsh-bundle` · `deepseek-harness` · `fengniao` · `riskbird` · `company-search` · `due-diligence` · `企业查询` · `工商查询` · `企业尽调`

风鸟（Riskbird）企业查询的 DeepSeek Harness（DSH）插件：安装后由 Agent 直接调用两个原生工具，按中文企业名称查询工商信息、股东、高管、对外投资、变更以及被执行/失信/经营异常等司法与经营风险数据；API Key 在「插件」页的配置卡片里保存。

## 特性

- **原生 Agent 工具**：`fengniao_search_company` 解析主体，`fengniao_company_dimension` 按 `entid` 查维度，由 Agent 直接调用
- **11 个企业维度**：工商、股东、高管、对外投资、变更、被执行、失信、限高、经营异常、严重违法、行政处罚
- **插件页配置 Key**：卡片写入本机 Harness 凭据库，不回显、不写入 profile 配置文件，保存即生效
- **三级 Key 回退**：`config.apiKey` → 凭据库 → 环境变量（Windows 下可直接读注册表，`setx` 后无需重启 DSH）
- **零运行时依赖**：只用 Node 内置 `fetch` 与 `node:test`，无 npm 依赖、无构建步骤
- **同源安全路由**：配置接口只注册在本机 Web 服务上，并要求自定义请求头，跨站页面无法在不触发 CORS 预检的情况下伪造请求

## 快速开始

### 1. 安装

在 DSH 侧边栏的「插件」页可以直接从 GitHub 仓库安装，不需要手动下载或敲命令：

1. 打开「插件」页；
2. 点右上角「添加插件」（箭头菜单里是「安装第三方插件」）；
3. 在「包名或地址」输入框里粘贴本仓库地址：

   ```text
   https://github.com/keyblues/dsh-plugin-fengniao-company-search
   ```

4. 点「安装」，等待下载完成（需要本机能访问 github.com）；
5. 安装完成后插件自动启用：进入本插件详情页，在配置卡片里保存 API Key。

不同网络环境下的输入方式：

| 场景 | 「包名或地址」怎么填 |
| --- | --- |
| 能正常访问 GitHub（推荐） | `https://github.com/keyblues/dsh-plugin-fengniao-company-search` |
| GitHub 连不上 | 先 `git clone` 本仓库，再填本地目录的绝对路径；DSH 会以 `link:` 方式安装该目录 |
| 想让 Agent 代劳 | 在对话框里直接说「安装插件 https://github.com/keyblues/dsh-plugin-fengniao-company-search」 |

补充说明：

- 新安装无需重启即可生效（Host 行与 Client 模块会热加载）；**更新已安装插件后需要重启 DSH**，运行中的进程不会重新加载已修改的 Host 模块。
- 卸载：在「插件」页打开本插件详情 → 卸载。
- GitHub 安装失败通常是网络问题（`ECONNRESET`、连接超时），改用上面的本地目录方式即可。

### 2. 配置 API Key

打开「插件」页 → 本插件详情 → 在配置卡片里粘贴 Key 并保存。Key 的解析优先级：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `config.apiKey` | profile `cordis.patch.yml` 内直接写入，优先级最高 |
| 2 | Harness 凭据库 | 插件页保存，引用名由 `credentialRef` 指定（默认 `FENGNIAO_API_KEY`）；**推荐** |
| 3 | 环境变量 | 变量名由 `apiKeyEnv` 指定（默认 `FN_API_KEY`）；先读进程环境，Windows 上再回退读用户/系统环境变量注册表（30 秒缓存） |

### 3. 开始使用

直接用自然语言提问即可：

- “帮我查一下比亚迪的企业尽调和风险”
- “信数科技的法人是谁、股东有哪些”
- “这家供应商有没有被执行/失信记录”

Agent 会先调用 `fengniao_search_company` 解析主体拿到 `entid`，再按需调用 `fengniao_company_dimension`；名称有歧义时会先向你确认主体。

## 工具参考

### `fengniao_search_company`

按中文名称模糊搜索企业，返回候选企业的工商全称与 `entid`。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 是 | 企业中文名称或简称；英文无效 |

返回 `query`、`count` 与 `candidates[]`（`name`、`entid`、接口返回时的 `status`，以及原始记录 `raw`），最多 20 条。查维度前必须先用本工具取得 `entid`。

### `fengniao_company_dimension`

按 `entid` 查询一个企业维度。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `entid` | string | 是 | 来自 `fengniao_search_company` 的企业标识 |
| `dimension` | string | 是 | 维度枚举，见下表 |

返回 `dimension`、`label`、`apiCode`、`success`、`state`（`records` / `empty` / `unknown`）、`message`（接口有提示时）、`data`（上游原始 JSON）与 `truncated`。

> 每次调用消耗一次账号额度，不要重复查询同一维度；结果过长时会截断渲染，但 `data` 仍完整返回。

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

## 配置项

全部可选，代码内有默认值：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `apiKey` | 空 | 直接写入的 Key，优先级最高；建议改用插件页或凭据库 |
| `credentialRef` | `FENGNIAO_API_KEY` | Harness 凭据库引用名（插件页保存的位置） |
| `apiKeyEnv` | `FN_API_KEY` | 环境变量名回退；Windows 支持直接读注册表 |
| `baseUrl` | `https://m.riskbird.com/prod-qbb-api` | 接口地址，仅内部联调需要修改 |
| `timeoutMs` | `30000` | 单次接口超时（毫秒，5000–120000） |

## 获取 API Key

登录风鸟 Web 端，在「账户设置 → API Key」生成个人 API Key（完整 Key 只展示一次）。
多个 Key 共用同一账号的每日额度，创建多个 Key 不会增加可用次数；额度以风鸟 API Key 页面展示为准。

## 错误码

| code | 含义 | 处理方式 |
| --- | --- | --- |
| `9999` + apikey 不合法/未配置 | Key 无效或尚未配置 | 到插件页重新保存 Key |
| `9999` + 访问已达上限 | 账号当日额度用完 | 隔天再试，不要重试 |
| `8888` | `entid` 或参数错误 | 重新调用 `fengniao_search_company` 获取 `entid` |
| `20000` | 请求成功；`state=empty` 表示该维度无记录 | 正常展示「未查询到相关记录」 |

## 测试

```bash
npm test        # 等价于 node --test，仅用 Node 内置 test runner，无需安装依赖
```

覆盖：两个工具 `execute()` 返回值与声明 `output.schema` 的一致性（DSH 按 `additionalProperties:false` 校验，未声明字段会让整次调用失败）、上游错误码映射、Windows 注册表环境变量解析、设置路由的自定义请求头校验与「不回显 Key」断言。

## 故障排查

- **插件页显示「配置接口不可达」**：设置路由要等 DSH 的 Web 服务挂载后才注册（启动顺序不保证），重开插件页即可，无需重启。
- **设置了 `FN_API_KEY` 却显示未配置**：插件先读进程环境，再直接读 Windows 用户/系统环境变量注册表（30 秒缓存），`setx` 后通常立即生效；仍读不到时重开一次 DSH。
- **更新代码后行为没变**：运行中的 DSH 不会重新加载已修改的 Host 模块，重启 DSH 后生效。
- **最稳妥的方式**：直接在插件页的配置卡片里保存 Key（写入 Harness 凭据库，优先级高于环境变量）。

## 文件结构

```text
index.js            Host 半：工具注册 + 上游 HTTP + 同源配置路由 + 凭据读写
client.js           Client 半：插件页内的 API Key 配置卡片
cordis.patch.yml    bundle 清单（插入 fengniao-company-search 行）
locale/*.json       插件页展示的标题与描述
icon.svg            插件图标
test/plugin.test.js 输出契约、错误码、注册表解析与设置路由的回归测试
```

## 安全边界

- 只从配置 / Harness 凭据库 / 环境变量读取 Key，不读取其他插件或用户目录里的配置
- Key 仅通过上游要求的 `apikey` URL 查询参数发送；不写入日志、不回显给页面（页面只显示尾号提示）
- 配置路由只注册在 DSH 本机 Web 服务上（同源），并要求自定义请求头 `x-fengniao-plugin: 1`：跨站页面无法在不触发 CORS 预检的情况下伪造，避免任意网页 CSRF 改写 Key

## 兼容性

- Node.js ≥ 20（DSH 内置 Node 即可）
- DSH `>=0.2.1-rc.3 <0.3.0-0`：由 `package.json` 的 `engines.dsh` 声明，装错版本时 DSH 会直接拒绝安装；已在 `0.2.1-rc.3` 上验证
- 依赖 `tools` 服务；`webServer`、`credentials` 为可选服务（缺失时对应能力不可用）；Client 半使用 `plugins.bundle.config` 插槽

## License

[MIT](LICENSE) © keyblues
