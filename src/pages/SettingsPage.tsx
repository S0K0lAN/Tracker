import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  Image,
  Link2,
  LogOut,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WifiOff,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Toast } from '../components/Toast'
import { pluginRegistry } from '../core/plugins/PluginRegistry'
import { useApp } from '../state/AppContext'
import type { BackgroundPreset } from '../domain/models'
import './settings-backgrounds.css'

export function SettingsPage() {
  const {
    state,
    updateSettings,
    updateSyncProviderConfig,
    persistState,
    syncProviders,
    syncConflict,
    importBackupAvailable,
    selectSyncProvider,
    connectSyncProvider,
    disconnectSyncProvider,
    syncNow,
    resolveSyncConflict,
    restoreImportBackup,
    resetDemo,
  } = useApp()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPluginDetails, setShowPluginDetails] = useState(false)
  const [confirmLocalOverwrite, setConfirmLocalOverwrite] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [appearanceStatus, setAppearanceStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const appearanceReadyRef = useRef(false)
  const backgroundRef = useRef<HTMLInputElement>(null)
  const plugins = pluginRegistry.list()
  const syncing = state.sync.status === 'syncing' || state.sync.status === 'connecting'
  const selectedProvider = syncProviders.find((provider) => provider.id === state.settings.syncProvider)
  const interactiveSelected = selectedProvider?.connection === 'interactive'
  const selectedProviderConfig = state.settings.syncProviderConfigs[state.settings.syncProvider] ?? {}
  const fieldValue = (key: string, defaultValue?: string) => selectedProviderConfig[key] ?? defaultValue ?? ''
  const missingRequiredConfig = selectedProvider?.configFields?.some((field) => (
    field.required && !fieldValue(field.key, field.defaultValue).trim()
  )) ?? false
  const connected = state.sync.connectionStatus === 'connected'
  const authorizationRequired = state.sync.connectionStatus === 'authorization-required'
  const statusLabel = state.sync.status === 'conflict'
    ? 'Нужен выбор'
    : syncing
      ? 'Синхронизация'
      : authorizationRequired
        ? 'Нужен вход'
        : connected
          ? state.sync.status === 'success' ? 'Синхронизировано' : 'Подключено'
          : state.sync.status === 'error' ? 'Ошибка' : 'Отключено'
  const appearanceKey = JSON.stringify({
    theme: state.settings.theme,
    accent: state.settings.accent,
    backgroundPreset: state.settings.backgroundPreset,
    customBackgroundDataUrl: state.settings.customBackgroundDataUrl,
    backgroundDim: state.settings.backgroundDim,
  })

  const updateAppearance = (settings: Parameters<typeof updateSettings>[0]) => {
    updateSettings(settings)
  }

  useEffect(() => {
    if (!appearanceReadyRef.current) {
      appearanceReadyRef.current = true
      return
    }
    let cancelled = false
    setAppearanceStatus('saving')
    void persistState().then(
      () => { if (!cancelled) setAppearanceStatus('saved') },
      () => { if (!cancelled) setAppearanceStatus('error') },
    )
    return () => { cancelled = true }
    // appearanceKey is the complete persisted appearance snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceKey])

  useEffect(() => {
    setConfirmLocalOverwrite(false)
  }, [syncConflict])

  const readBackground = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setBackgroundError('Выберите изображение')
      return
    }
    if (file.size > 1_500_000) {
      setBackgroundError('Фон должен быть меньше 1,5 МБ')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    updateAppearance({ backgroundPreset: 'custom', customBackgroundDataUrl: dataUrl })
    setBackgroundError('')
  }

  return (
    <main className="page page--settings">
      <PageHeader eyebrow="Ваше пространство" title="Настройки" description="Подстройте Focus Flow под свой ритм" />

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Разделы настроек">
          <a href="#appearance"><Palette size={17} /> Внешний вид</a>
          <a href="#behavior"><SlidersHorizontal size={17} /> Поведение</a>
          <a href="#sync"><Cloud size={17} /> Синхронизация</a>
          <a href="#plugins"><Plug size={17} /> Расширения</a>
          <a href="#data"><Database size={17} /> Данные</a>
        </nav>
        <div className="settings-sections">
          <section className="settings-card" id="appearance">
            <header><span><Palette /></span><div><h2>Внешний вид</h2><p>Тема и визуальный акцент</p></div></header>
            <div className="setting-row">
              <div><strong>Тема</strong><span>Выберите комфортный режим</span></div>
              <div className="segmented">
                {(['light', 'dark', 'system'] as const).map((theme) => (
                  <button key={theme} className={state.settings.theme === theme ? 'is-selected' : ''} onClick={() => updateAppearance({ theme })}>
                    {{ light: 'Светлая', dark: 'Тёмная', system: 'Системная' }[theme]}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <div><strong>Акцент</strong><span>Основной цвет интерфейса</span></div>
              <div className="accent-picker">
                {(['sage', 'violet', 'coral'] as const).map((accent) => (
                  <button key={accent} className={`${state.settings.accent === accent ? 'is-selected' : ''} accent-${accent}`} onClick={() => updateAppearance({ accent })} aria-label={`Акцент ${accent}`} />
                ))}
              </div>
            </div>
            <div className="setting-row setting-row--background">
              <div><strong>Фон пространства</strong><span>Спокойный фон под рабочими панелями</span></div>
              <div className="background-picker" aria-label="Фон пространства">
                {([
                  ['none', 'Без фона'],
                  ['mist', 'Туман'],
                  ['dawn', 'Рассвет'],
                  ['forest', 'Лес'],
                ] as [BackgroundPreset, string][]).map(([preset, label]) => (
                  <button
                    type="button"
                    key={preset}
                    className={`background-swatch background-swatch--${preset} ${state.settings.backgroundPreset === preset ? 'is-selected' : ''}`}
                    onClick={() => updateAppearance({ backgroundPreset: preset })}
                    aria-label={`Фон: ${label}`}
                    aria-pressed={state.settings.backgroundPreset === preset}
                  ><span>{label}</span></button>
                ))}
                <button type="button" className={`background-swatch background-swatch--custom ${state.settings.backgroundPreset === 'custom' ? 'is-selected' : ''}`} onClick={() => backgroundRef.current?.click()} aria-label="Загрузить свой фон">
                  {state.settings.customBackgroundDataUrl ? <img src={state.settings.customBackgroundDataUrl} alt="" /> : <Upload size={16} />}
                  <span>Свой</span>
                </button>
                <input ref={backgroundRef} hidden type="file" accept="image/*" onChange={(event) => void readBackground(event.target.files?.[0])} />
              </div>
              {backgroundError && <small className="background-error">{backgroundError}</small>}
            </div>
            {state.settings.backgroundPreset !== 'none' && (
              <label className="setting-row">
                <div><strong>Затемнение фона</strong><span>Чтобы текст и панели оставались читаемыми</span></div>
                <span className="background-range"><Image size={15} /><input aria-label="Затемнение фона" type="range" min="10" max="80" step="5" value={state.settings.backgroundDim} onChange={(event) => updateAppearance({ backgroundDim: Number(event.target.value) })} /><em>{state.settings.backgroundDim}%</em></span>
              </label>
            )}
            <footer className="appearance-actions">
              <span className={`appearance-status appearance-status--${appearanceStatus}`} aria-live="polite">
                {appearanceStatus === 'saved' && <><CheckCircle2 size={15} /> Оформление сохранено локально</>}
                {appearanceStatus === 'saving' && <>Сохраняем оформление…</>}
                {appearanceStatus === 'error' && <>Не удалось сохранить оформление</>}
              </span>
            </footer>
          </section>

          <section className="settings-card" id="behavior">
            <header><span><SlidersHorizontal /></span><div><h2>Поведение</h2><p>Плотность и анимации</p></div></header>
            <label className="setting-row">
              <div><strong>Компактный режим</strong><span>Больше задач на экране</span></div>
              <input className="switch" type="checkbox" checked={state.settings.compactMode} onChange={(event) => updateSettings({ compactMode: event.target.checked })} />
            </label>
            <label className="setting-row">
              <div><strong>Уменьшить анимации</strong><span>Минимум визуального движения</span></div>
              <input className="switch" type="checkbox" checked={state.settings.reduceMotion} onChange={(event) => updateSettings({ reduceMotion: event.target.checked })} />
            </label>
            <label className="setting-row">
              <div><strong>Срочность по умолчанию</strong><span>Порог до дедлайна</span></div>
              <select value={state.settings.defaultUrgencyThresholdHours} onChange={(event) => updateSettings({ defaultUrgencyThresholdHours: Number(event.target.value) })}>
                <option value={24}>1 день</option><option value={72}>3 дня</option><option value={168}>7 дней</option>
              </select>
            </label>
          </section>

          <section className="settings-card settings-card--sync" id="sync">
            <header><span><Cloud /></span><div><h2>Синхронизация</h2><p>Local-first копия в выбранном хранилище</p></div>
              <span className={`status-pill status-pill--${state.sync.status}`}>
                {state.sync.status === 'success' ? <CheckCircle2 size={14} /> : state.sync.status === 'error' ? <WifiOff size={14} /> : state.sync.status === 'conflict' ? <CircleAlert size={14} /> : <HardDrive size={14} />}
                {statusLabel}
              </span>
            </header>
            <div className="drive-explainer"><ShieldCheck size={21} /><p><strong>Ваши данные остаются вашими.</strong><br />{selectedProvider?.privacyNote ?? 'Провайдер работает через изолированный адаптер хранения.'}</p></div>
            <div className="setting-row">
              <div><strong>Хранилище</strong><span>{selectedProvider?.description ?? 'Этот провайдер сейчас недоступен'}</span></div>
              <select aria-label="Провайдер синхронизации" value={state.settings.syncProvider} disabled={syncing} onChange={(event) => void selectSyncProvider(event.target.value)}>
                {!selectedProvider && <option value={state.settings.syncProvider}>{state.settings.syncProvider} · недоступен</option>}
                {syncProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
              </select>
            </div>
            {selectedProvider?.configFields?.map((field) => (
              <label className="field drive-token" key={field.key}>
                <span>{field.label}</span>
                <input
                  type="text"
                  value={fieldValue(field.key, field.defaultValue)}
                  disabled={syncing || (connected && interactiveSelected)}
                  required={field.required}
                  onChange={(event) => updateSyncProviderConfig(field.key, event.target.value.trim())}
                  placeholder={field.placeholder}
                  aria-label={field.label}
                  autoComplete="off"
                />
                {field.description && <small>{field.description}</small>}
              </label>
            ))}
            {missingRequiredConfig && <small className="sync-config-error">Заполните обязательные параметры хранилища.</small>}
            <label className="setting-row">
              <div><strong>Автосинхронизация</strong><span>Через 1,8 секунды после локальных изменений, пока подключение активно</span></div>
              <input className="switch" type="checkbox" checked={state.settings.autoSync} onChange={(event) => updateSettings({ autoSync: event.target.checked })} />
            </label>
            <div className="sync-actions">
              {interactiveSelected && !connected ? (
                <button className="button button--primary" disabled={syncing || missingRequiredConfig} onClick={() => void connectSyncProvider()}>
                  {syncing ? <RefreshCw className="spin" size={17} /> : <Link2 size={17} />}
                  {syncing ? 'Подключение…' : authorizationRequired ? `Продолжить с ${selectedProvider.name}` : `Подключить ${selectedProvider.name}`}
                </button>
              ) : (
                <button className="button button--primary" disabled={syncing || !selectedProvider || missingRequiredConfig} onClick={() => void syncNow()}>
                  <RefreshCw className={syncing ? 'spin' : ''} size={17} /> {syncing ? 'Синхронизация…' : 'Проверить и синхронизировать'}
                </button>
              )}
              {interactiveSelected && connected && (
                <button className="button button--ghost" disabled={syncing} onClick={() => void disconnectSyncProvider()}><LogOut size={16} /> Отключить</button>
              )}
              <button className="button button--ghost" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Скрыть детали' : 'Показать детали'}</button>
            </div>
            {syncConflict && (
              <section className="sync-conflict" role="alert" aria-label="Конфликт синхронизации">
                <header><CircleAlert size={20} /><div><strong>В хранилище уже есть другая копия</strong><span>Ничего не будет перезаписано без вашего выбора.</span></div></header>
                <div className="sync-conflict__compare">
                  <span><strong>Это устройство</strong><small>{syncConflict.local.tasks} задач · {syncConflict.local.projects} проектов · {syncConflict.local.habits} привычек</small><em>{syncConflict.local.recentTaskTitles.join(' · ') || 'Нет задач'}</em></span>
                  <span><strong>Хранилище</strong><small>{syncConflict.remote.tasks} задач · {syncConflict.remote.projects} проектов · {syncConflict.remote.habits} привычек</small><em>{syncConflict.remote.recentTaskTitles.join(' · ') || 'Нет задач'}</em></span>
                </div>
                <div className="sync-conflict__actions">
                  <button className="button button--primary" disabled={syncing} onClick={() => void resolveSyncConflict('remote')}><Download size={16} /> Загрузить из хранилища</button>
                  {!confirmLocalOverwrite ? (
                    <button className="button button--danger-ghost" disabled={syncing} onClick={() => setConfirmLocalOverwrite(true)}>Заменить копию локальными данными</button>
                  ) : (
                    <button className="button button--danger-ghost" disabled={syncing} onClick={() => void resolveSyncConflict('local')}>Точно заменить копию в хранилище</button>
                  )}
                  <button className="button button--ghost" disabled={syncing} onClick={() => { setConfirmLocalOverwrite(false); void resolveSyncConflict('cancel') }}>Отмена</button>
                </div>
                {state.sync.status === 'error' && <p className="sync-conflict__error">{state.sync.message}</p>}
              </section>
            )}
            {state.sync.message && !syncConflict && <Toast tone={state.sync.status === 'error' ? 'error' : 'success'}>{state.sync.message}</Toast>}
            {showAdvanced && (
              <div className="sync-details">
                <span><strong>Локальное хранилище</strong><small>Browser JSON adapter · готово</small></span>
                <span><strong>{selectedProvider?.name ?? state.settings.syncProvider}</strong><small>{state.sync.remoteRevision ? `Ревизия ${state.sync.remoteRevision}` : 'Удалённая копия ещё не привязана'}</small></span>
                {selectedProvider?.consistency === 'best-effort' && <span><strong>Защита от конфликтов</strong><small>Проверка ревизии перед записью; провайдер не гарантирует атомарный compare-and-swap</small></span>}
                <span><strong>Последняя синхронизация</strong><small>{state.sync.lastSyncedAt ? new Date(state.sync.lastSyncedAt).toLocaleString('ru-RU') : 'ещё не выполнялась'}</small></span>
              </div>
            )}
          </section>

          <section className="settings-card" id="plugins">
            <header><span><Plug /></span><div><h2>Расширения</h2><p>Версионированные точки подключения</p></div><span className="status-pill">API v1</span></header>
            <div className="plugin-empty"><Sparkles /><div><strong>{plugins.length ? `${plugins.length} расширений подключено` : 'Готово к расширению'}</strong><p>Плагины смогут добавлять действия задач, панели и настройки без доступа к внутреннему состоянию.</p></div><button className="button button--ghost" onClick={() => setShowPluginDetails(!showPluginDetails)}>{showPluginDetails ? 'Скрыть' : 'Контракты'} <ExternalLink size={15} /></button></div>
            {showPluginDetails && (
              <div className="plugin-contracts">
                <code>task-actions</code><code>sidebar</code><code>settings</code>
                <p>Plugin API v1 принимает только заявленные capabilities и не предоставляет прямой доступ к store, файлам или токенам.</p>
              </div>
            )}
          </section>

          <section className="settings-card" id="data">
            <header><span><Database /></span><div><h2>Локальные данные</h2><p>Управление демонстрационным пространством</p></div></header>
            {importBackupAvailable && (
              <div className="setting-row">
                <div><strong>Копия до импорта</strong><span>Вернуть локальные данные, которые были до загрузки из хранилища</span></div>
                <button className="button button--ghost" disabled={syncing} onClick={() => void restoreImportBackup()}><RotateCcw size={16} /> Восстановить</button>
              </div>
            )}
            <div className="setting-row">
              <div><strong>Восстановить демо-данные</strong><span>Текущие локальные изменения будут заменены</span></div>
              <button className="button button--danger-ghost" disabled={syncing} onClick={() => void resetDemo()}><RotateCcw size={16} /> Сбросить</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
