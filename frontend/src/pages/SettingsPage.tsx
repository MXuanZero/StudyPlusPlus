import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getLLMSettings,
  resetLLMSettings,
  testLLMSettings,
  updateLLMSettings,
  type KeySource,
  type LLMProvider,
  type LLMSettings,
  type LLMSettingsUpdate,
  type LLMTestResult,
} from '../api/settings'
import { useAppStore } from '../store/appStore'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'

interface ProviderPreset {
  label: string
  base_url: string
  model: string
  tip: string
}

/** 供应商只是默认值，所有字段都可以自由修改（不得写死）。 */
const PROVIDER_PRESETS: Record<LLMProvider, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek（默认）',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    tip: '默认供应商，请求会自动补全 /v1。',
  },
  openai: {
    label: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    tip: '标准 OpenAI 兼容接口。',
  },
  ollama: {
    label: 'Ollama（本地）',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    tip: '本地模型，无需 API Key（Key 留空即可）。',
  },
  custom: {
    label: '自定义 OpenAI 兼容接口',
    base_url: '',
    model: '',
    tip: '填写任意兼容 /chat/completions 协议的服务地址与模型名。',
  },
}

const KEY_SOURCE_LABEL: Record<KeySource, string> = {
  database: '设置页保存',
  environment: '环境变量 LLM_API_KEY',
  none: '未配置',
}

interface FormState {
  provider: LLMProvider
  base_url: string
  model: string
  api_key: string
  temperature: number
  max_tokens: number
}

function formFromSettings(settings: LLMSettings): FormState {
  const known = (settings.provider as LLMProvider) in PROVIDER_PRESETS
  return {
    provider: known ? (settings.provider as LLMProvider) : 'custom',
    base_url: settings.base_url,
    model: settings.model,
    api_key: '',
    temperature: settings.temperature,
    max_tokens: settings.max_tokens,
  }
}

export function SettingsPage() {
  const pushToast = useAppStore((state) => state.pushToast)

  const [settings, setSettings] = useState<LLMSettings | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const applySettings = (next: LLMSettings) => {
    setSettings(next)
    setForm(formFromSettings(next))
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getLLMSettings()
      .then((data) => {
        if (active) applySettings(data)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '读取设置失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const maskedKey = settings?.api_key_masked || settings?.masked_api_key || ''

  const dirty = useMemo(() => {
    if (!settings || !form) return false
    return (
      form.provider !== settings.provider ||
      form.base_url !== settings.base_url ||
      form.model !== settings.model ||
      Number(form.temperature) !== settings.temperature ||
      Number(form.max_tokens) !== settings.max_tokens ||
      form.api_key.trim() !== ''
    )
  }, [form, settings])

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous))
    setTestResult(null)
  }

  const changeProvider = (provider: LLMProvider) => {
    const preset = PROVIDER_PRESETS[provider]
    setForm((previous) =>
      previous
        ? {
            ...previous,
            provider,
            base_url: provider === 'custom' ? previous.base_url : preset.base_url,
            model: provider === 'custom' ? previous.model : preset.model,
            api_key: '',
          }
        : previous,
    )
    setTestResult(null)
  }

  const validate = (): string | null => {
    if (!form) return '表单未就绪'
    if (!form.provider) return '请选择模型供应商'
    if (!form.base_url.trim()) return 'Base URL 不能为空'
    if (!form.model.trim()) return '模型名不能为空'
    if (!Number.isFinite(Number(form.temperature)) || Number(form.temperature) < 0 || Number(form.temperature) > 2) {
      return '温度必须在 0 到 2 之间'
    }
    if (!Number.isInteger(Number(form.max_tokens)) || Number(form.max_tokens) < 1) {
      return '最大输出长度必须是正整数'
    }
    return null
  }

  const handleSave = async () => {
    if (!form) return
    const message = validate()
    if (message) {
      pushToast(message, 'error')
      return
    }
    const payload: LLMSettingsUpdate = {
      provider: form.provider,
      base_url: form.base_url.trim(),
      model: form.model.trim(),
      temperature: Number(form.temperature),
      max_tokens: Number(form.max_tokens),
    }
    // 留空表示不修改已有 Key，绝不把空串写回后端。
    if (form.api_key.trim()) payload.api_key = form.api_key.trim()
    setSaving(true)
    try {
      const updated = await updateLLMSettings(payload)
      applySettings(updated)
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
      pushToast('设置已保存并立即生效', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testLLMSettings()
      setTestResult(result)
      if (result.ok) pushToast('连接测试通过', 'success')
      else pushToast(`连接测试失败：${result.message}`, 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : '测试失败'
      setTestResult({
        ok: false,
        mode: 'mock',
        message,
        provider: form?.provider ?? '',
        model: form?.model ?? '',
        latency_ms: null,
        code: 'REQUEST_ERROR',
      })
      pushToast(`连接测试失败：${message}`, 'error')
    } finally {
      setTesting(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('恢复为默认 DeepSeek 配置？已保存的 API Key 会被清除。')) return
    setResetting(true)
    try {
      const updated = await resetLLMSettings()
      applySettings(updated)
      setTestResult(null)
      pushToast('已恢复默认配置', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '恢复默认失败', 'error')
    } finally {
      setResetting(false)
    }
  }

  if (loading) return <CenteredSpinner label="读取模型设置…" />

  if (error || !form || !settings) {
    return (
      <div className="settings-page">
        <h1>设置</h1>
        <div className="placeholder-note">
          {error ?? '设置加载失败'}
          <div style={{ marginTop: 10 }}>
            <Button onClick={() => window.location.reload()}>重新加载</Button>
          </div>
        </div>
      </div>
    )
  }

  const preset = PROVIDER_PRESETS[form.provider]

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>模型设置</h1>
        <span className={`badge ${settings.mode === 'live' ? 'badge-success' : 'badge-warning'}`}>
          {settings.mode === 'live' ? 'live 模式' : 'mock 模式'}
        </span>
        <span className="badge">Key 来源：{KEY_SOURCE_LABEL[settings.key_source]}</span>
      </div>
      <p className="settings-sub">
        配置保存在后端 SQLite，保存后立即生效；前端不会持久化 API Key。
      </p>

      {settings.mode === 'mock' ? (
        <div className="status-banner mock">
          <div>
            <div className="status-title">当前为 Mock 模式</div>
            尚未配置可用的大模型 Key，AI 助手会返回内置占位回复。课程阅读、二阶实验室和进度笔记不受影响。
            填写并保存 Key 后即可切换为 live 模式。
          </div>
        </div>
      ) : (
        <div className="status-banner live">
          <div>
            <div className="status-title">当前为 live 模式</div>
            已连接 {settings.provider} / {settings.model}，实际请求地址：
            <span className="mono"> {settings.effective_base_url}</span>
          </div>
        </div>
      )}

      <div className="card settings-card">
        <h2>大模型配置</h2>
        <div className="form-grid">
          <div className="form-row">
            <label className="form-label" htmlFor="llm-provider">
              供应商
            </label>
            <select
              id="llm-provider"
              className="form-control"
              value={form.provider}
              onChange={(event) => changeProvider(event.target.value as LLMProvider)}
            >
              {(Object.keys(PROVIDER_PRESETS) as LLMProvider[]).map((key) => (
                <option key={key} value={key}>
                  {PROVIDER_PRESETS[key].label}
                </option>
              ))}
            </select>
            <span className="form-hint">{preset.tip}</span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="llm-model">
              模型名
            </label>
            <input
              id="llm-model"
              className="form-control mono"
              value={form.model}
              placeholder="例如 deepseek-chat"
              onChange={(event) => updateField('model', event.target.value)}
            />
            <span className="form-hint">只要兼容 OpenAI 协议，模型名可自由填写。</span>
          </div>

          <div className="form-row full">
            <label className="form-label" htmlFor="llm-base-url">
              Base URL
            </label>
            <input
              id="llm-base-url"
              className="form-control mono"
              value={form.base_url}
              placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
              onChange={(event) => updateField('base_url', event.target.value)}
            />
            <span className="form-hint">
              后端会自动规范化地址：缺少 /v1 时补齐，已包含 /chat/completions 时幂等处理。
            </span>
          </div>

          <div className="form-row full">
            <label className="form-label" htmlFor="llm-api-key">
              API Key
            </label>
            <input
              id="llm-api-key"
              className="form-control mono"
              type="password"
              autoComplete="new-password"
              value={form.api_key}
              placeholder={
                settings.has_api_key
                  ? `已保存：${maskedKey || '••••'}（留空表示不修改）`
                  : '尚未配置；留空保存将保持 Mock 模式'
              }
              onChange={(event) => updateField('api_key', event.target.value)}
            />
            <span className="form-hint">
              Key 只发送到后端 SQLite；页面、localStorage 和日志都不会保存它。留空保存不会清除已有 Key。
            </span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="llm-temperature">
              温度 temperature
            </label>
            <div className="form-row-inline">
              <input
                id="llm-temperature"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(event) => updateField('temperature', Number(event.target.value))}
              />
              <span className="value-pill">{form.temperature.toFixed(1)}</span>
            </div>
            <span className="form-hint">越低越稳定，越高越有创造性；范围 0–2。</span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="llm-max-tokens">
              最大输出长度 max_tokens
            </label>
            <input
              id="llm-max-tokens"
              className="form-control"
              type="number"
              min={1}
               step={128}
              value={form.max_tokens}
              onChange={(event) => updateField('max_tokens', Number(event.target.value))}
            />
            <span className="form-hint">单次回复的最大 token 数。</span>
          </div>
        </div>

        <div className="settings-actions">
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </Button>
          <Button onClick={() => void handleTest()} disabled={testing || saving}>
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <span className="spacer" />
          <Button variant="danger" onClick={() => void handleReset()} disabled={resetting || saving}>
            {resetting ? '恢复中…' : '恢复默认 DeepSeek'}
          </Button>
        </div>

        {dirty ? (
          <p className="form-hint" style={{ marginTop: 10 }}>
            有未保存的修改；“测试连接”测试的是后端已保存的配置，建议先保存再测试。
          </p>
        ) : savedAt ? (
          <p className="form-hint" style={{ marginTop: 10 }}>
            上次保存：{savedAt}
          </p>
        ) : null}

        {testResult ? (
          <div className={`test-result ${testResult.ok ? (testResult.mode === 'mock' ? 'mock' : 'ok') : 'fail'}`}>
            <strong>{testResult.ok ? '测试通过' : '测试失败'}</strong>
            <div style={{ marginTop: 4 }}>{testResult.message}</div>
            <div style={{ marginTop: 4 }}>
              {testResult.provider} / {testResult.model} · 模式 {testResult.mode}
              {testResult.latency_ms !== null ? ` · ${testResult.latency_ms} ms` : ''}
              {testResult.code ? ` · ${testResult.code}` : ''}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card settings-card">
        <h2>安全说明</h2>
        <ul className="kv-list">
          <li className="kv">
            <span className="k">Key 存储</span>
            <span className="v">仅后端 SQLite 的 app_settings，接口响应只返回脱敏结果。</span>
          </li>
          <li className="kv">
            <span className="k">前端存储</span>
            <span className="v">不写入 localStorage / sessionStorage，也不在控制台打印。</span>
          </li>
          <li className="kv">
            <span className="k">当前 Mask</span>
            <span className="v mono">{settings.has_api_key ? maskedKey || '已配置（未返回明文）' : '未配置'}</span>
          </li>
        </ul>
      </div>

      <Link className="btn" to="/">
        返回首页
      </Link>
    </div>
  )
}
