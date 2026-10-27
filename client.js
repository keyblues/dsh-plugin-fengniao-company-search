/**
 * Fengniao (Riskbird) company search — DSH Client half.
 *
 * Renders the API-key configuration card inside this bundle's page on the
 * Plugins page (`plugins.bundle.config`, keyed by the bundle package name),
 * exactly like the shipped "思考过程机器翻译" bundle: no separate settings
 * page, everything is configured where the plugin itself is listed.
 *
 * The card only talks to the Host half's same-origin routes; the API key is
 * written to the Harness credential store and never sent back to the page.
 */
window.__ModuleLoader__.load({
  id: '@local/fengniao-company-search',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace shared with the Host bundle metadata. */
    const NS = 'fengniao-company-search';
    /** Must stay in sync with ROUTE_PREFIX in index.js. */
    const ROUTE = '/plugins/fengniao-company-search';

    const DICT = {
      en: {
        'status.loading': 'Reading configuration…',
        'status.configured': 'Configured',
        'status.missing': 'No API key yet',
        'status.loadFailed': 'Could not read the configuration.',
        'source.credential': 'Harness credentials',
        'source.config': 'plugin config',
        'source.env': 'environment variable',
        'source.none': 'none',
        keyLabel: 'API key',
        keyPlaceholder: 'Paste the personal API key generated in Fengniao',
        save: 'Save',
        saving: 'Saving…',
        test: 'Test connection',
        testing: 'Testing…',
        clear: 'Remove key',
        clearing: 'Removing…',
        confirmClear: 'Remove the stored Fengniao API key?',
        saved: 'API key saved.',
        cleared: 'API key removed.',
        testOk: 'Connection works',
        testFailed: 'Connection failed',
        loadFailed: 'The configuration route is unreachable. Reload the page and retry.',
        invalidDraft: 'Paste a complete API key first.',
        hintStorage:
          'The key is stored in the local Harness credential store (never written to the profile settings file and never echoed back); only the last characters are shown. The environment variable FENGNIAO_API_KEY and the plugin config field apiKey are also accepted.',
        hintGenerate:
          'Generate the key in the Fengniao web console under Account settings → API Key; the full key is shown only once.',
        endpoint: 'Endpoint',
        quota: 'Each dimension query consumes one Fengniao request from the account daily quota.',
      },
      zh: {
        'status.loading': '正在读取配置…',
        'status.configured': '已配置',
        'status.missing': '尚未配置 API Key',
        'status.loadFailed': '无法读取配置。',
        'source.credential': 'Harness 凭据库',
        'source.config': '插件配置',
        'source.env': '环境变量',
        'source.none': '无',
        keyLabel: 'API Key',
        keyPlaceholder: '粘贴风鸟 Web 端生成的个人 API Key',
        save: '保存',
        saving: '保存中…',
        test: '测试连接',
        testing: '测试中…',
        clear: '清除 Key',
        clearing: '清除中…',
        confirmClear: '确定要删除已保存的风鸟 API Key 吗？',
        saved: 'API Key 已保存。',
        cleared: 'API Key 已清除。',
        testOk: '连接正常',
        testFailed: '连接失败',
        loadFailed: '配置接口不可达，请刷新页面重试。',
        invalidDraft: '请先粘贴完整的 API Key。',
        hintStorage:
          'Key 保存在本机 Harness 凭据库（不写入 profile 配置文件、不回显），页面只显示尾号；也支持环境变量 FENGNIAO_API_KEY 或插件配置 apiKey。',
        hintGenerate:
          'Key 获取方式：风鸟 Web 端「账户设置 → API Key」生成个人 API Key，完整 Key 仅展示一次。',
        endpoint: '接口地址',
        quota: '每次维度查询消耗一次风鸟账号当日额度。',
      },
    };

    /** Best-effort locale for the module-level fallback translator. */
    function detectLocale() {
      try {
        const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
        return lang.startsWith('zh') ? 'zh' : 'en';
      } catch {
        return 'en';
      }
    }

    /** Local dictionary fallback used when the page does not supply `t`. */
    function fallbackTranslate(key) {
      const dict = DICT[detectLocale()] ?? DICT.en;
      return dict[key] ?? DICT.en[key] ?? key;
    }

    /** Translate through the page's bound `t`, falling back to our own dictionary. */
    function makeTranslator(bound) {
      if (typeof bound !== 'function') return fallbackTranslate;
      return (key) => {
        let value;
        try {
          value = bound(key);
        } catch {
          return fallbackTranslate(key);
        }
        return value === undefined || value === key ? fallbackTranslate(key) : value;
      };
    }

    /** Read one JSON response, rejecting non-2xx and `ok: false` payloads. */
    async function readJson(response) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
      return payload;
    }

    /** One async operation with its own busy/notice state, safe after unmount. */
    function useSettingsCard() {
      const [phase, setPhase] = React.useState('loading');
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState(null);
      const mounted = React.useRef(true);

      const applyStatus = React.useCallback((next) => {
        if (!mounted.current) return;
        setStatus(next);
        setPhase('ready');
      }, []);

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${ROUTE}/settings`, {
            cache: 'no-store',
            headers: { accept: 'application/json', 'x-fengniao-plugin': '1' },
          });
          const payload = await readJson(response);
          applyStatus(payload);
        } catch {
          if (!mounted.current) return;
          setPhase('error');
        }
      }, [applyStatus]);

      React.useEffect(() => {
        mounted.current = true;
        void load();
        return () => {
          mounted.current = false;
        };
      }, [load]);

      /** Run one card action, keeping a single busy flag and one result notice. */
      const run = React.useCallback(
        async (kind, request, describe) => {
          if (!mounted.current) return;
          setBusy(kind);
          setNotice(null);
          try {
            const result = await request();
            if (!mounted.current) return;
            setNotice(describe(result));
            if (result?.ok !== false && typeof result?.configured === 'boolean') applyStatus(result);
          } catch (error) {
            if (!mounted.current) return;
            setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
          } finally {
            if (mounted.current) setBusy('');
          }
        },
        [applyStatus],
      );

      return { phase, status, busy, notice, setNotice, load, run };
    }

    /** One compact status chip describing where the key comes from. */
    function StatusChip({ t, status }) {
      if (status === null || status === undefined) return h('span', { className: 'fcs_chip', 'data-tone': 'muted' }, t('status.loading'));
      if (status.configured !== true) return h('span', { className: 'fcs_chip', 'data-tone': 'muted' }, t('status.missing'));
      const source = t(`source.${status.source ?? 'none'}`);
      const hint = typeof status.hint === 'string' && status.hint !== '' ? ` ${status.hint}` : '';
      return h('span', { className: 'fcs_chip', 'data-tone': 'ok' }, `${t('status.configured')} · ${source}${hint}`);
    }

    /** The configuration card rendered in the bundle's page on the Plugins page. */
    function FengniaoConfigCard(props) {
      const t = React.useMemo(() => makeTranslator(props?.t), [props?.t]);
      const { phase, status, busy, notice, setNotice, load, run } = useSettingsCard();
      const [draft, setDraft] = React.useState('');
      const ready = phase === 'ready' && status !== null;
      const configured = ready && status.configured === true;

      React.useEffect(() => {
        if (phase === 'error') setNotice({ tone: 'error', text: t('loadFailed') });
        else if (phase === 'ready') setNotice(null);
      }, [phase, setNotice, t]);

      const save = React.useCallback(() => {
        const apiKey = draft.trim();
        if (apiKey === '') {
          setNotice({ tone: 'error', text: t('invalidDraft') });
          return;
        }
        void run(
          'save',
          async () => {
            const response = await fetch(`${ROUTE}/settings`, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json', accept: 'application/json', 'x-fengniao-plugin': '1' },
              body: JSON.stringify({ apiKey }),
            });
            const payload = await readJson(response);
            if (payload.ok === false) throw new Error(payload.error ?? 'save failed');
            return payload;
          },
          (result) => {
            setDraft('');
            return { tone: 'ok', text: result?.saved === true ? t('saved') : t('saved') };
          },
        );
      }, [draft, run, setNotice, t]);

      const test = React.useCallback(() => {
        void run(
          'test',
          async () => {
            const response = await fetch(`${ROUTE}/test`, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json', accept: 'application/json', 'x-fengniao-plugin': '1' },
              body: JSON.stringify({}),
            });
            const payload = await readJson(response);
            if (payload.ok !== true) {
              const detail = typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : t('testFailed');
              const code = payload.apiCode === null || payload.apiCode === undefined ? '' : ` · code ${payload.apiCode}`;
              throw new Error(`${detail}${code}`);
            }
            return payload;
          },
          (result) => ({
            tone: 'ok',
            text: `${t('testOk')} · HTTP ${result.httpStatus} · ${result.latencyMs}ms`,
          }),
        );
      }, [run, t]);

      const clear = React.useCallback(() => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('confirmClear'))) return;
        void run(
          'clear',
          async () => {
            const response = await fetch(`${ROUTE}/settings`, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json', accept: 'application/json', 'x-fengniao-plugin': '1' },
              body: JSON.stringify({ clear: true }),
            });
            const payload = await readJson(response);
            if (payload.ok === false) throw new Error(payload.error ?? 'clear failed');
            return payload;
          },
          () => ({ tone: 'ok', text: t('cleared') }),
        );
      }, [run, t]);

      if (props?.view === 'summary') {
        return h('span', { className: 'fcs_summary' }, h(StatusChip, { t, status: ready ? status : null }));
      }

      const canSave = draft.trim() !== '' && busy === '';
      const canTest = configured && busy === '';
      const canClear = configured && status?.source === 'credential' && busy === '';

      return h(
        'div',
        { className: 'fcs_card' },
        h(
          'div',
          { className: 'fcs_header' },
          h('span', { className: 'fcs_title' }, '风鸟企业查询', h('span', { className: 'fcs_titleEn' }, ' · Fengniao')),
          h(StatusChip, { t, status: ready ? status : null }),
        ),
        h(
          'label',
          { className: 'fcs_field' },
          h('span', { className: 'fcs_fieldLabel' }, t('keyLabel')),
          h('input', {
            className: 'fcs_input',
            type: 'password',
            value: draft,
            autoComplete: 'off',
            spellCheck: false,
            placeholder: t('keyPlaceholder'),
            disabled: busy !== '' || phase !== 'ready',
            onChange: (event) => {
              setDraft(event.target.value);
              if (notice !== null && notice.tone === 'error') setNotice(null);
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' && canSave) save();
            },
          }),
        ),
        h(
          'div',
          { className: 'fcs_actions' },
          h(
            'button',
            { type: 'button', className: 'fcs_button fcs_primary', disabled: !canSave, onClick: save },
            busy === 'save' ? t('saving') : t('save'),
          ),
          h(
            'button',
            { type: 'button', className: 'fcs_button', disabled: !canTest, onClick: test },
            busy === 'test' ? t('testing') : t('test'),
          ),
          canClear
            ? h(
                'button',
                { type: 'button', className: 'fcs_button fcs_danger', disabled: busy !== '', onClick: clear },
                busy === 'clear' ? t('clearing') : t('clear'),
              )
            : null,
        ),
        notice !== null
          ? h('div', { className: 'fcs_notice', 'data-tone': notice.tone }, notice.text)
          : null,
        h('p', { className: 'fcs_hint' }, t('hintStorage')),
        h('p', { className: 'fcs_hint' }, t('hintGenerate')),
        h(
          'p',
          { className: 'fcs_meta' },
          `${t('endpoint')}: ${ready ? status.baseUrl : '—'} · ${t('quota')}`,
        ),
      );
    }

    const CSS = `
.fcs_summary{color:var(--dsw-alias-label-secondary);font-size:inherit}
.fcs_card{gap:8px;display:grid;max-width:100%}
.fcs_header{align-items:center;justify-content:space-between;gap:12px;display:flex;flex-wrap:wrap}
.fcs_title{color:var(--dsw-alias-label-primary);font-weight:500;font-size:13px;line-height:20px}
.fcs_titleEn{color:var(--dsw-alias-label-tertiary);font-weight:400}
.fcs_chip{box-sizing:border-box;border-radius:999px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap;font-size:11px;line-height:18px;padding:1px 8px;border:none}
.fcs_chip[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
.fcs_field{gap:6px;display:grid}
.fcs_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.fcs_input{box-sizing:border-box;width:100%;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px}
.fcs_input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.fcs_input::placeholder{color:var(--dsw-alias-label-tertiary)}
.fcs_input:disabled{opacity:.6}
.fcs_actions{align-items:center;gap:8px;display:flex;flex-wrap:wrap;margin-top:2px}
.fcs_button{box-sizing:border-box;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:none;cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:4px 12px}
.fcs_button:hover:enabled{color:var(--dsw-alias-label-primary)}
.fcs_button:disabled{cursor:default;opacity:.5}
.fcs_primary{color:var(--dsw-alias-label-primary);font-weight:500}
.fcs_danger{color:var(--dsw-alias-state-error-primary)}
.fcs_notice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-word}
.fcs_notice[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
.fcs_notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.fcs_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.6}
.fcs_meta{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.6;word-break:break-all}
`;

    /** Register the card and own its dictionary and stylesheet. */
    function apply(ctx) {
      let translate = fallbackTranslate;
      if (typeof ctx.locale?.bind === 'function') {
        try {
          translate = ctx.locale.bind(NS);
        } catch {
          translate = fallbackTranslate;
        }
      }
      if (typeof ctx.locale?.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { en: DICT.en, zh: DICT.zh }), 'fengniao: dictionaries');
      }
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/fengniao-company-search';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'fengniao: stylesheet');
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: '@local/fengniao-company-search',
            locale: NS,
            label: () => translate('keyLabel'),
          },
          FengniaoConfigCard,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
