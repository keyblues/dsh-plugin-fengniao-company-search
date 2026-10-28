/**
 * Fengniao (Riskbird) China company search — DSH Host plugin.
 *
 * Two model-facing tools over the Fengniao (Riskbird) HTTP API
 * (`https://m.riskbird.com/prod-qbb-api`):
 *   - `fengniao_search_company`   — fuzzy company-name search → candidates + entid
 *   - `fengniao_company_dimension` — one data dimension for an entid
 *
 * Plus three same-origin JSON routes consumed by this bundle's Client half
 * (client.js), which the Plugins page renders inside this bundle's detail page
 * (`plugins.bundle.config`):
 *   GET  {prefix}/settings  → current key status (never the key itself)
 *   POST {prefix}/settings  → save / clear the API key
 *   POST {prefix}/test      → one live probe against the upstream API
 *
 * API key resolution order: config.apiKey → Harness credentials
 * (config.credentialRef, default FENGNIAO_API_KEY) → environment variable
 * (config.apiKeyEnv, default FN_API_KEY). The key travels as the upstream
 * `apikey` query parameter required by the upstream API.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const TAG = '[fengniao-company-search]';
const DEFAULT_BASE_URL = 'https://m.riskbird.com/prod-qbb-api';
const DEFAULT_CREDENTIAL_REF = 'FENGNIAO_API_KEY';
const DEFAULT_API_KEY_ENV = 'FN_API_KEY';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 5000;
const ROUTE_PREFIX = '/plugins/fengniao-company-search';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RENDER_CHARS = 16000;
const SEARCH_LIMIT = 20;
const USER_AGENT = 'dsh-fengniao-company-search/1.0';

/** Promisified `execFile` backing the Windows registry environment fallback. */
const execFileAsync = promisify(execFile);
/** Short-lived cache of persisted Windows environment values, keyed by name. */
const persistedEnvCache = new Map();

/**
 * Extract the value of one `reg query` data line (`NAME    REG_SZ    value`).
 * Splitting on runs of spaces would lose values that contain them and would
 * return the type token (`REG_SZ`) for an empty value, so the type token is
 * matched explicitly and everything after it is the value.
 * @param {string} line - one trimmed data line.
 * @param {string} name - the queried variable name.
 * @returns {string} the value, or `''` when the line carries none.
 */
function parseRegValueLine(line, name) {
  const match = /^\s*(REG_[A-Za-z0-9_]+)\s*([\s\S]*)$/u.exec(line.slice(name.length));
  return match === null ? '' : match[2].trim();
}

/**
 * Read a Windows environment variable the user persisted (User or Machine
 * scope) straight from the registry. The GUI can be launched before a
 * `setx`/Settings change reaches new processes, so `process.env` may lag by one
 * launch; reading the registry makes a saved FN_API_KEY work immediately.
 * At most one `reg query` per name per 30s.
 */
async function readPersistedWindowsEnv(name) {
  if (process.platform !== 'win32' || name === '') return '';
  const cached = persistedEnvCache.get(name);
  if (cached !== undefined && Date.now() - cached.at < 30000) return cached.value;
  const hives = [
    'HKCU\\Environment',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  ];
  for (const hive of hives) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', hive, '/v', name], {
        windowsHide: true,
        timeout: 3000,
        maxBuffer: 64 * 1024,
      });
      const line = stdout.split(/\r?\n/).find((entry) => {
        const trimmed = entry.trim();
        // Exact name match, not a prefix of a longer variable such as NAME_EXTRA.
        return trimmed.startsWith(name) && /^\s/u.test(trimmed.slice(name.length));
      });
      const value = line === undefined ? '' : parseRegValueLine(line.trim(), name);
      if (value !== '') {
        persistedEnvCache.set(name, { at: Date.now(), value });
        return value;
      }
    } catch {
      // Variable absent from this hive; try the next one.
    }
  }
  persistedEnvCache.set(name, { at: Date.now(), value: '' });
  return '';
}

/**
 * Supported data dimensions. `version` is the upstream `dataDimension?version=` value.
 */
const DIMENSIONS = {
  basic_info: {
    version: 'B1',
    label: '企业基本信息',
    hint: '工商注册、法定代表人、注册资本、成立日期、统一社会信用代码、注册地址、经营范围、经营状态、行业分类',
  },
  shareholders: {
    version: 'B2',
    label: '企业股东信息',
    hint: '股东名单、持股比例、认缴出资额、股东类型（自然人/法人）、认缴日期、出资方式',
  },
  executives: {
    version: 'B3',
    label: '企业高级职员',
    hint: '董事、监事、高管及法定代表人，含姓名、职务、持股比例',
  },
  investments: {
    version: 'B4',
    label: '企业对外投资',
    hint: '被投公司列表，含持股比例、被投企业经营状态、成立日期、注册资本、法定代表人',
  },
  changes: {
    version: 'B5',
    label: '企业工商变更',
    hint: '工商登记变更历史：变更项目、变更前、变更后、变更日期',
  },
  executed: {
    version: 'C2',
    label: '被执行人',
    hint: '被执行案件：执行法院、执行标的、案号、立案日期',
  },
  dishonest: {
    version: 'C3',
    label: '失信被执行人',
    hint: '失信被执行人记录：失信情形、执行依据、发布法院、发布日期',
  },
  limit_consumption: {
    version: 'C4',
    label: '限制高消费',
    hint: '限制高消费记录：限制内容、执行法院、案号、发布日期',
  },
  abnormal_operation: {
    version: 'D1',
    label: '经营异常',
    hint: '经营异常名录：列入原因、列入日期、作出决定机关、移出信息',
  },
  serious_illegal: {
    version: 'D2',
    label: '严重违法',
    hint: '严重违法失信名单：违法类型、列入原因、列入日期、作出决定机关',
  },
  admin_penalty: {
    version: 'D11',
    label: '行政处罚',
    hint: '行政处罚记录：决定书文号、处罚事由、处罚结果、处罚机关、处罚日期',
  },
};

/** Dimension keys in declaration order (the tool's enum). */
const DIMENSION_KEYS = Object.keys(DIMENSIONS);

/** Compact labels for the dimension parameter description (model-facing, keep short). */
const DIMENSION_SHORT = {
  basic_info: '工商',
  shareholders: '股东',
  executives: '高管',
  investments: '对外投资',
  changes: '变更',
  executed: '被执行',
  dishonest: '失信',
  limit_consumption: '限高',
  abnormal_operation: '经营异常',
  serious_illegal: '严重违法',
  admin_penalty: '行政处罚',
};

/** Thrown for upstream/HTTP failures; carries the machine-readable detail. */
class FengniaoApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FengniaoApiError';
    this.httpStatus = typeof options.httpStatus === 'number' ? options.httpStatus : 0;
    this.apiCode = Number.isFinite(Number(options.apiCode)) ? Number(options.apiCode) : null;
  }
}

/** Read a non-empty trimmed string, else the fallback. */
function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** Clamp a config number into `[MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]`. */
function timeoutOf(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
}

/** Normalize the plugin's raw Cordis config into resolved values. */
function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {};
  let baseUrl = text(config.baseUrl, DEFAULT_BASE_URL).replace(/\/+$/u, '');
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') baseUrl = DEFAULT_BASE_URL;
  } catch {
    baseUrl = DEFAULT_BASE_URL;
  }
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    credentialRef: text(config.credentialRef, DEFAULT_CREDENTIAL_REF),
    apiKeyEnv: text(config.apiKeyEnv, DEFAULT_API_KEY_ENV),
    baseUrl,
    timeoutMs: timeoutOf(config.timeoutMs),
  };
}

/** Last four characters only — a hint that never reconstructs the key. */
function maskKey(key) {
  const value = typeof key === 'string' ? key.trim() : '';
  if (value === '') return '';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

/** Resolve the key from the credential store or the launch environment. */
async function readStoredKey(ctx, config) {
  const credentials = ctx.get('credentials');
  if (credentials !== void 0 && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(config.credentialRef);
      const value = typeof resolved === 'string' ? resolved : resolved?.value;
      if (typeof value === 'string' && value.trim() !== '') {
        return { key: value.trim(), source: 'credential' };
      }
    } catch {
      // Fall through to the environment.
    }
  }
  const fromProcess = typeof process.env[config.apiKeyEnv] === 'string' ? process.env[config.apiKeyEnv].trim() : '';
  if (fromProcess !== '') return { key: fromProcess, source: 'env' };
  const persisted = await readPersistedWindowsEnv(config.apiKeyEnv);
  if (persisted !== '') return { key: persisted, source: 'env' };
  return { key: '', source: 'none' };
}

/** Resolve one call's key: literal config first, then the credential store, then the environment. */
async function resolveApiKey(ctx, config) {
  if (config.apiKey !== '') return { key: config.apiKey, source: 'config' };
  return await readStoredKey(ctx, config);
}

/** Key status for the settings card; never returns the key itself. */
async function keyStatus(ctx, config) {
  const resolved = await resolveApiKey(ctx, config);
  return {
    ok: true,
    configured: resolved.key !== '',
    source: resolved.source,
    hint: maskKey(resolved.key),
    baseUrl: config.baseUrl,
    credentialRef: config.credentialRef,
  };
}

/** One upstream GET with `apikey` in the URL query, bounded in time. */
async function callApi({ config, apiKey, endpoint, params, signal }) {
  const url = new URL(`${config.baseUrl}${endpoint}`);
  url.searchParams.set('apikey', apiKey);
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== void 0) url.searchParams.set(name, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`风鸟接口请求超时（${config.timeoutMs}ms）`));
  }, config.timeoutMs);
  const onAbort = () => {
    controller.abort(signal?.reason);
  };
  if (signal !== void 0) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;
    try {
      payload = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const detail = typeof payload?.msg === 'string' && payload.msg !== '' ? payload.msg : `HTTP ${response.status}`;
      throw new FengniaoApiError(`风鸟接口 HTTP ${response.status}：${detail}`, {
        httpStatus: response.status,
        apiCode: payload?.code,
      });
    }
    if (payload === undefined || payload === null || typeof payload !== 'object') {
      throw new FengniaoApiError('风鸟接口返回了无法解析的响应（非 JSON）', { httpStatus: response.status });
    }
    return { payload, httpStatus: response.status };
  } catch (error) {
    if (error instanceof FengniaoApiError) throw error;
    if (controller.signal.aborted) {
      throw new FengniaoApiError(
        controller.signal.reason instanceof Error ? controller.signal.reason.message : '风鸟接口请求已取消',
      );
    }
    throw new FengniaoApiError(`风鸟接口请求失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    if (signal !== void 0) signal.removeEventListener('abort', onAbort);
  }
}

/** Turn an upstream failure envelope into an actionable model-facing error. */
function describeApiFailure(payload) {
  const code = Number.isFinite(Number(payload?.code)) ? Number(payload.code) : null;
  const message = typeof payload?.msg === 'string' && payload.msg !== '' ? payload.msg : '风鸟接口返回失败';
  if (code === 9999) {
    if (/上限|额度|次数/u.test(message)) {
      return `${message}。当前账号当日接口额度已用完；额度以风鸟 Web 端 API Key 页面展示为准，不要重试。`;
    }
    return `${message}。API Key 未配置或无效：请在 DSH「插件」页打开“风鸟企业查询”，在配置卡片中粘贴风鸟 Web 端生成的个人 API Key（账户设置 → API Key），或设置环境变量 FN_API_KEY。`;
  }
  if (code === 8888) {
    return `${message}。entid 或参数错误：请先调用 fengniao_search_company 重新获取 entid，再重试本维度查询。`;
  }
  return `${message}（code=${code === null ? 'unknown' : String(code)}）。`;
}

/**
 * Whether an upstream envelope is a failure. `success: false` is authoritative
 * when present, but an error can also arrive as `code` 9999 (key/quota) or
 * 8888 (argument) without it, so those codes fail on their own.
 * @param {unknown} payload - upstream JSON envelope.
 * @returns {boolean} whether to surface the envelope as an error.
 */
function isApiFailure(payload) {
  if (payload !== null && typeof payload === 'object' && payload.success === false) return true;
  const code = Number(payload?.code);
  return code === 9999 || code === 8888;
}

/** Pick the first string field present on a raw record. */
function pickString(record, keys) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** Upstream record list from the several shapes a searchHint payload may use. */
function candidateRecords(data) {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    for (const key of ['list', 'items', 'records', 'rows', 'data', 'result']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/** Normalize one candidate while keeping the raw record lossless. */
function toCandidate(record) {
  const candidate = {};
  const name = pickString(record, ['entname', 'entName', 'name', 'companyName', 'company_name', 'ent_name']);
  const entid = pickString(record, ['entid', 'entId', 'ent_id', 'id', 'eid']);
  const status = pickString(record, ['status', 'regstatus', 'regStatus', 'regStatusName', 'operStatus', 'oper_status', 'entstatus', 'entStatus']);
  if (name !== undefined) candidate.name = name;
  if (entid !== undefined) candidate.entid = entid;
  if (status !== undefined) candidate.status = status;
  if (record !== null && typeof record === 'object' && !Array.isArray(record)) candidate.raw = record;
  return candidate;
}

/** Bounded pretty JSON for a model-facing text block. */
function jsonText(value) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (typeof text !== 'string') text = String(text);
  if (text.length <= MAX_RENDER_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_RENDER_CHARS)}\n…（已截断，仅显示前 ${MAX_RENDER_CHARS} 字符）`, truncated: true };
}

/** Render the search result as compact markdown lines. */
function renderSearch(value) {
  if (value.count === 0) {
    return `未找到匹配“${value.query}”的企业。换用企业全称或常见简称再试；风鸟搜索只接受中文关键词。`;
  }
  const lines = [`“${value.query}”匹配到 ${value.count} 家企业：`];
  value.candidates.forEach((candidate, index) => {
    const name = typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : '(未返回名称)';
    const status = typeof candidate.status === 'string' && candidate.status !== '' ? ` · ${candidate.status}` : '';
    const entid = typeof candidate.entid === 'string' && candidate.entid !== '' ? ` · entid: ${candidate.entid}` : '';
    lines.push(`${index + 1}. ${name}${status}${entid}`);
  });
  lines.push('entid 仅供后续调用，不要展示给用户；企业名称用工商全称。');
  return lines.join('\n');
}

/**
 * Classify a dimension payload's record state from its content, never from the
 * envelope code: a healthy `dataDimension` answer uses code 20000 and can still
 * carry a full object under `data.apiData`.
 */
function dimensionState(data) {
  if (data === null || data === undefined) return 'empty';
  if (Array.isArray(data)) return data.length === 0 ? 'empty' : 'records';
  if (typeof data !== 'object') return 'unknown';
  const inner = data.apiData ?? data.result ?? data.data ?? data.records ?? data.list;
  if (inner !== null && inner !== undefined) {
    if (Array.isArray(inner)) return inner.length === 0 ? 'empty' : 'records';
    if (typeof inner === 'object') return Object.keys(inner).length === 0 ? 'empty' : 'records';
    return 'unknown';
  }
  for (const key of ['totalCount', 'total', 'count']) {
    if (Number.isFinite(Number(data[key]))) return Number(data[key]) === 0 ? 'empty' : 'records';
  }
  return Object.keys(data).length === 0 ? 'empty' : 'unknown';
}

/** Render one dimension result as a readable header plus the upstream payload. */
function renderDimension(value) {
  const hint = DIMENSIONS[value.dimension]?.hint ?? '';
  const body = jsonText(value.data ?? null);
  const lines = [`风鸟 · ${value.label}（${value.dimension}）`];
  if (hint !== '') lines.push(`维度内容：${hint}`);
  if (value.state === 'empty') {
    lines.push('未查询到相关记录。');
  } else {
    if (value.message !== undefined && value.message !== '') lines.push(`接口提示：${value.message}`);
    lines.push('以下为上游返回的原始数据：');
    lines.push('```json');
    lines.push(body.text);
    lines.push('```');
  }
  if (value.truncated || body.truncated) {
    lines.push('（结果过长已截断；如需完整数据，请缩小查询范围或按需查询其他维度。）');
  }
  return lines.join('\n');
}

/** Register the two model-facing tools. */
function registerTools(ctx, config) {
  const searchTool = {
    name: 'fengniao_search_company',
    description:
      '按中文名称模糊搜索中国企业，返回候选企业的工商全称与 entid。查维度前必须先用本工具取得 entid；名称有歧义时先与用户确认主体。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keyword: {
          type: 'string',
          description: '企业中文名称或简称；英文无效。',
        },
      },
      required: ['keyword'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          count: { type: 'integer' },
          candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        required: ['query', 'count', 'candidates'],
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    timeoutMs: config.timeoutMs + 10000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      if (keyword === '') throw new Error('keyword 不能为空：请传企业中文名称或简称。');
      const resolved = await resolveApiKey(ctx, config);
      if (resolved.key === '') throw new Error(API_KEY_MISSING_MESSAGE);
      const { payload } = await callApi({
        config,
        apiKey: resolved.key,
        endpoint: '/skills/searchHint',
        params: { key: keyword },
        signal: exec.signal,
      });
      if (isApiFailure(payload)) throw new Error(describeApiFailure(payload));
      const candidates = candidateRecords(payload.data)
        .slice(0, SEARCH_LIMIT)
        .map(toCandidate);
      return { query: keyword, count: candidates.length, candidates };
    },
  };

  const dimensionTool = {
    name: 'fengniao_company_dimension',
    description:
      '按 entid 查询一个企业维度（工商、股东、高管、投资、变更、司法与经营风险）。每次调用消耗一次接口额度，不要重复查同一维度。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        entid: {
          type: 'string',
          description: '来自 fengniao_search_company 的企业标识。',
        },
        dimension: {
          type: 'string',
          enum: DIMENSION_KEYS,
          description: `维度：${DIMENSION_KEYS.map((key) => `${key} ${DIMENSION_SHORT[key]}`).join('、')}。`,
        },
      },
      required: ['entid', 'dimension'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dimension: { type: 'string' },
          label: { type: 'string' },
          apiCode: { type: 'integer' },
          success: { type: 'boolean' },
          state: { type: 'string', enum: ['records', 'empty', 'unknown'] },
          message: { type: 'string' },
          data: {},
          truncated: { type: 'boolean' },
        },
        required: ['dimension', 'label', 'apiCode', 'success', 'state', 'truncated'],
      },
      render: (_args, value) => [{ type: 'text', text: renderDimension(value) }],
    },
    timeoutMs: config.timeoutMs + 10000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const entid = typeof args.entid === 'string' ? args.entid.trim() : '';
      const dimension = typeof args.dimension === 'string' ? args.dimension : '';
      if (entid === '') throw new Error('entid 不能为空：请先调用 fengniao_search_company 获取 entid。');
      const spec = DIMENSIONS[dimension];
      if (spec === undefined) {
        throw new Error(`不支持的 dimension“${dimension}”；可取值：${DIMENSION_KEYS.join('、')}。`);
      }
      const resolved = await resolveApiKey(ctx, config);
      if (resolved.key === '') throw new Error(API_KEY_MISSING_MESSAGE);
      const { payload } = await callApi({
        config,
        apiKey: resolved.key,
        endpoint: '/skills/dataDimension',
        params: { version: spec.version, entid },
        signal: exec.signal,
      });
      if (isApiFailure(payload)) throw new Error(describeApiFailure(payload));
      const data = payload.data === undefined ? null : payload.data;
      const rendered = jsonText(data);
      const state = dimensionState(data);
      const rawMessage = typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : '';
      const message = rawMessage === '' || rawMessage === '成功' || rawMessage.toLowerCase() === 'ok' ? undefined : rawMessage;
      return {
        dimension,
        label: spec.label,
        apiCode: Number.isFinite(Number(payload.code)) ? Number(payload.code) : -1,
        success: payload.success !== false,
        state,
        ...message === undefined ? {} : { message },
        data,
        truncated: rendered.truncated,
      };
    },
  };

  ctx.effect(() => ctx.tools.register(searchTool), 'fengniao: fengniao_search_company');
  ctx.effect(() => ctx.tools.register(dimensionTool), 'fengniao: fengniao_company_dimension');
  return [searchTool.name, dimensionTool.name];
}

/** Exported for local rendering checks and tests; not part of the plugin contract. */
export { dimensionState, parseRegValueLine, renderDimension, renderSearch };

const API_KEY_MISSING_MESSAGE = [
  '尚未配置风鸟 API Key。',
  '获取方式：登录风鸟 Web 端，在「账户设置 → API Key」生成个人 API Key（完整 Key 只展示一次）。',
  '配置方式（任选其一）：',
  '1) 在 DSH「插件」页打开“风鸟企业查询”，在配置卡片中粘贴 API Key 并保存（推荐，写入本机 Harness 凭据库）；',
  '2) 设置环境变量 FN_API_KEY 后重启 Harness；',
  '3) 在本 profile 的 cordis.patch.yml 中为 fengniao-company-search 行设置 config.apiKey。',
].join('\n');

/** JSON response helper. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Read one bounded JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Save or clear the API key in the Harness credential store. */
async function writeApiKey(ctx, config, apiKey) {
  const credentials = ctx.get('credentials');
  if (credentials === void 0 || typeof credentials.set !== 'function') {
    throw new Error('Harness 凭据服务不可用，无法保存 API Key；请改用环境变量 FN_API_KEY 或插件配置 apiKey。');
  }
  if (apiKey === '') {
    if (typeof credentials.unset !== 'function') {
      throw new Error('Harness 凭据服务不支持删除 Key，无法清除已保存的 API Key。');
    }
    await credentials.unset(config.credentialRef);
    return;
  }
  if (apiKey.length < 6 || apiKey.length > 512) {
    throw new Error('API Key 长度应在 6–512 字符之间，请检查是否复制完整。');
  }
  await credentials.set(config.credentialRef, apiKey);
}

/** Register the same-origin settings routes used by the Plugins page card. */
function registerRoutes(ctx, webServer, config) {
  const handler = async (req, res) => {
    // DSH's own browser routes require authentication; plugin routes are
    // loopback-open. A custom header makes the card's requests non-simple, so a
    // cross-origin page cannot reach these routes without a CORS preflight this
    // plugin never grants — i.e. no drive-by page can rewrite the stored key.
    if (req.headers['x-fengniao-plugin'] !== '1') {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid url' });
      return;
    }
    const sub = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : '';
    try {
      if (req.method === 'GET' && sub === '/settings') {
        sendJson(res, 200, await keyStatus(ctx, config));
        return;
      }
      if (req.method === 'POST' && sub === '/settings') {
        const body = await readJsonBody(req);
        if (body.clear === true) {
          await writeApiKey(ctx, config, '');
        } else if (typeof body.apiKey === 'string') {
          await writeApiKey(ctx, config, body.apiKey.trim());
        } else {
          sendJson(res, 200, { ok: false, error: '缺少 apiKey 或 clear 字段' });
          return;
        }
        sendJson(res, 200, { ...(await keyStatus(ctx, config)), saved: true });
        return;
      }
      if (req.method === 'POST' && sub === '/test') {
        const body = await readJsonBody(req);
        const override = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        const resolved = override !== '' ? { key: override, source: 'input' } : await resolveApiKey(ctx, config);
        if (resolved.key === '') {
          sendJson(res, 200, { ok: false, httpStatus: 0, apiCode: null, msg: '尚未配置 API Key，无法测试。', latencyMs: 0, source: resolved.source });
          return;
        }
        const startedAt = Date.now();
        try {
          const { payload, httpStatus } = await callApi({
            config,
            apiKey: resolved.key,
            endpoint: '/skills/searchHint',
            params: { key: '腾讯' },
            signal: new AbortController().signal,
          });
          const apiCode = Number.isFinite(Number(payload.code)) ? Number(payload.code) : null;
          // A healthy search answers code 20000 / "成功"; only `success: false`,
          // 9999 (key/quota), and 8888 (argument) count as failures.
          const ok = !isApiFailure(payload);
          sendJson(res, 200, {
            ok,
            httpStatus,
            apiCode,
            msg: typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : ok ? '连接成功' : '风鸟接口返回失败',
            latencyMs: Date.now() - startedAt,
            source: resolved.source,
          });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            httpStatus: error instanceof FengniaoApiError ? error.httpStatus : 0,
            apiCode: error instanceof FengniaoApiError ? error.apiCode : null,
            msg: error instanceof Error ? error.message : String(error),
            latencyMs: Date.now() - startedAt,
            source: resolved.source,
          });
        }
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
}

/** Cordis plugin name for loader diagnostics. */
export const name = 'fengniao-company-search';

/** The tool registry is a hard dependency; webServer/credentials are optional. */
export const inject = ['tools'];

/**
 * Mount the settings routes once a live `webServer` exists. At boot this
 * plugin can activate before the web host does, so `ctx.get('webServer')` is
 * followed by a reactive `ctx.inject` that fires when the service mounts.
 */
function mountSettingsRoutes(ctx, config) {
  let mounted = false;
  const mount = (hostCtx) => {
    if (mounted) return;
    const webServer = hostCtx.get('webServer');
    if (webServer === void 0 || typeof webServer.register !== 'function') return;
    mounted = true;
    hostCtx.effect(() => registerRoutes(hostCtx, webServer, config), 'fengniao: settings routes');
  };
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => mount(webCtx));
  }
  // The service is often already live at activation (reload/HMR) — register now.
  mount(ctx);
  if (!mounted) {
    console.info(`${TAG} webServer not available yet; settings routes will mount when it appears`);
  }
}

/** Cordis plugin entry. */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  registerTools(ctx, config);
  mountSettingsRoutes(ctx, config);
}
