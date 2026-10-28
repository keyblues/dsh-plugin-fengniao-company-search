/**
 * Regression tests for the Host half's model-facing contract.
 *
 * The tool registry validates every `execute()` result against the definition's
 * `output.schema` (`additionalProperties: false` included), so a returned field
 * missing from that schema fails the whole call. These tests execute both tools
 * against a mocked upstream and assert the returned shape stays declarable, and
 * cover the settings route's CSRF guard without touching the network.
 *
 * Run with `node --test` (Node's built-in test runner; no dependencies).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, dimensionState, parseRegValueLine, renderDimension, renderSearch } from '../index.js';

const ROUTE = '/plugins/fengniao-company-search';

/** Capture the tools and routes a plugin activation registers. */
function activate(rawConfig) {
  const tools = [];
  const routes = [];
  const webServer = {
    register(route) {
      routes.push(route);
      return () => {};
    },
  };
  const ctx = {
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    get(name) {
      return name === 'webServer' ? webServer : undefined;
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    inject() {
      return () => {};
    },
  };
  apply(ctx, rawConfig);
  return { tools: new Map(tools.map((tool) => [tool.name, tool])), routes };
}

/** Minimal `ToolRunContext` for a direct `execute()` call. */
const exec = { signal: new AbortController().signal };

/** Run one tool body with `fetch` mocked to answer the given JSON envelope. */
async function runWithPayload(tool, args, payload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    return await tool.execute(args, exec);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** Assert every returned key is declared and every required key is present. */
function assertDeclared(tool, value) {
  const schema = tool.output.schema;
  const declared = schema.properties ?? {};
  for (const key of Object.keys(value)) {
    assert.ok(Object.hasOwn(declared, key), `${tool.name} returns undeclared output property "${key}"`);
  }
  for (const key of schema.required ?? []) {
    assert.ok(Object.hasOwn(value, key), `${tool.name} omits required output property "${key}"`);
  }
}

/** Fake Node response recording the status, headers, and body it was given. */
function makeResponse() {
  const record = { status: 0, headers: {}, body: '' };
  return {
    record,
    writeHead(status, headers) {
      record.status = status;
      Object.assign(record.headers, headers ?? {});
    },
    end(chunk) {
      record.body = chunk === undefined ? '' : String(chunk);
    },
  };
}

/** Fake `IncomingMessage` for one settings request. */
function makeRequest({ method = 'GET', url, headers = {}, body }) {
  const listeners = new Map();
  const req = {
    method,
    url,
    headers,
    on(event, callback) {
      const list = listeners.get(event) ?? [];
      list.push(callback);
      listeners.set(event, list);
      return req;
    },
    destroy() {},
  };
  if (body !== undefined) {
    setImmediate(() => {
      for (const callback of listeners.get('data') ?? []) callback(Buffer.from(body));
      for (const callback of listeners.get('end') ?? []) callback();
    });
  }
  return req;
}

const SEARCH_ENVELOPE = {
  code: 20000,
  success: true,
  msg: '成功',
  data: { list: [{ entname: '腾讯科技（深圳）有限公司', entid: 'entid-1', status: '在营' }] },
};

const DIMENSION_ENVELOPE = {
  code: 20000,
  success: true,
  msg: '成功',
  data: { apiData: { name: '腾讯科技（深圳）有限公司', regCapital: '1000万元' } },
};

test('search output stays inside its declared schema', async () => {
  const { tools } = activate({ apiKey: 'test-key' });
  const tool = tools.get('fengniao_search_company');
  const value = await runWithPayload(tool, { keyword: '腾讯' }, SEARCH_ENVELOPE);
  assert.equal(value.count, 1);
  assert.equal(value.candidates[0].entid, 'entid-1');
  assertDeclared(tool, value);
});

test('dimension output stays inside its declared schema', async () => {
  const { tools } = activate({ apiKey: 'test-key' });
  const tool = tools.get('fengniao_company_dimension');
  const value = await runWithPayload(tool, { entid: 'entid-1', dimension: 'basic_info' }, DIMENSION_ENVELOPE);
  assert.equal(value.state, 'records');
  assertDeclared(tool, value);
  assert.match(renderDimension(value), /风鸟 · 企业基本信息/u);
});

test('dimension errors surface the key/quota guidance', async () => {
  const { tools } = activate({ apiKey: 'test-key' });
  const tool = tools.get('fengniao_company_dimension');
  await assert.rejects(
    runWithPayload(tool, { entid: 'entid-1', dimension: 'basic_info' }, { code: 9999, success: false, msg: 'apikey 不合法' }),
    /API Key/u,
  );
});

test('isApiFailure also treats bare 8888/9999 envelopes as failures', async () => {
  const { tools } = activate({ apiKey: 'test-key' });
  const tool = tools.get('fengniao_search_company');
  await assert.rejects(
    runWithPayload(tool, { keyword: '腾讯' }, { code: 8888, msg: '参数错误' }),
    /entid 或参数错误/u,
  );
});

test('parseRegValueLine keeps empty values empty and spaced values whole', () => {
  assert.equal(parseRegValueLine('FN_API_KEY    REG_SZ    fn_sk_abc', 'FN_API_KEY'), 'fn_sk_abc');
  assert.equal(parseRegValueLine('FN_API_KEY    REG_SZ', 'FN_API_KEY'), '');
  assert.equal(parseRegValueLine('FN_API_KEY    REG_SZ    fn sk  abc', 'FN_API_KEY'), 'fn sk  abc');
});

test('dimensionState classifies record, empty, and unknown payloads', () => {
  assert.equal(dimensionState(null), 'empty');
  assert.equal(dimensionState([]), 'empty');
  assert.equal(dimensionState({ apiData: [] }), 'empty');
  assert.equal(dimensionState({ apiData: {} }), 'empty');
  assert.equal(dimensionState({ apiData: { name: 'x' } }), 'records');
  assert.equal(dimensionState('scalar'), 'unknown');
});

test('renderSearch points at how to retry an empty result', () => {
  assert.match(renderSearch({ query: '不存在', count: 0, candidates: [] }), /未找到/u);
});

test('settings route rejects requests without the plugin header', async () => {
  const { routes } = activate({ apiKey: 'test-key' });
  const route = routes.find((entry) => entry.path === ROUTE && entry.kind === 'prefix');
  assert.ok(route !== undefined);
  const response = makeResponse();
  await route.handler({ method: 'GET', url: `${ROUTE}/settings`, headers: {} }, response);
  assert.equal(response.record.status, 403);
});

test('settings route reports status without echoing the key', async () => {
  const { routes } = activate({ apiKey: 'test-key' });
  const route = routes.find((entry) => entry.path === ROUTE && entry.kind === 'prefix');
  const response = makeResponse();
  await route.handler(
    { method: 'GET', url: `${ROUTE}/settings`, headers: { 'x-fengniao-plugin': '1' } },
    response,
  );
  assert.equal(response.record.status, 200);
  const payload = JSON.parse(response.record.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.configured, true);
  assert.equal(payload.source, 'config');
  assert.equal(payload.hint, '••••-key');
  assert.doesNotMatch(response.record.body, /test-key/u);
});

test('settings route fails loudly when the credential store cannot clear', async () => {
  const { routes } = activate({ apiKey: 'test-key' });
  const route = routes.find((entry) => entry.path === ROUTE && entry.kind === 'prefix');
  const response = makeResponse();
  await route.handler(
    makeRequest({
      method: 'POST',
      url: `${ROUTE}/settings`,
      headers: { 'x-fengniao-plugin': '1' },
      body: JSON.stringify({ clear: true }),
    }),
    response,
  );
  assert.equal(response.record.status, 500);
  assert.equal(JSON.parse(response.record.body).ok, false);
});
