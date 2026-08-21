import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { trapTabKey } from '../components/focusTrap'
import { pluginRegistry } from '../core/plugins/PluginRegistry'
import {
  assertPortableBackupFile,
  createPortableBackup,
  parsePortableBackup,
  PortableBackupError,
} from '../core/storage/PortableBackup'
import { summarizeSnapshot, type SnapshotSummary } from '../core/sync/RemoteSnapshot'
import { useApp } from '../state/AppContext'
import type { AppFontFamily, AppFontScale, AppState, BackgroundPreset } from '../domain/models'
import { safeCustomBackgroundDataUrl } from '../domain/backgrounds'
import './settings-backgrounds.css'

interface PendingBackupImport {
  fileName: string
  fileSize: number
  generatedAt?: string
  state: AppState
  summary: SnapshotSummary
}

export function SettingsPage() {
  const {
    state,
    updateSettings,
    updateSyncProviderConfig,
    persistState,
    syncProviders,
    syncConflict,
    activeSyncIntent,
    importBackupAvailable,
    selectSyncProvider,
    connectSyncProvider,
    disconnectSyncProvider,
    pullFromSyncProvider,
    pushToSyncProvider,
    syncNow,
    resolveSyncConflict,
    importLocalBackup,
    restoreImportBackup,
    resetDemo,
  } = useApp()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPluginDetails, setShowPluginDetails] = useState(false)
  const [confirmLocalOverwrite, setConfirmLocalOverwrite] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [backupError, setBackupError] = useState('')
  const [backupStatus, setBackupStatus] = useState('')
  const [pendingBackup, setPendingBackup] = useState<PendingBackupImport>()
  const [importingBackup, setImportingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [confirmDemoReset, setConfirmDemoReset] = useState(false)
  const [resettingDemo, setResettingDemo] = useState(false)
  const [appearanceStatus, setAppearanceStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const appearanceReadyRef = useRef(false)
  const backgroundRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const backupImportTriggerRef = useRef<HTMLButtonElement>(null)
  const backupDialogRef = useRef<HTMLElement>(null)
  const backupCancelRef = useRef<HTMLButtonElement>(null)
  const resetDemoTriggerRef = useRef<HTMLButtonElement>(null)
  const resetDemoCancelRef = useRef<HTMLButtonElement>(null)
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
  const syncActionsBlocked = syncing
    || Boolean(syncConflict)
    || importingBackup
    || restoringBackup
    || !selectedProvider
    || missingRequiredConfig
  const resetConfirmationBusy = syncing || importingBackup || restoringBackup || resettingDemo
  const authorizationRequired = state.sync.connectionStatus === 'authorization-required'
  const connectLabel = authorizationRequired
    ? selectedProvider?.resumeLabel ?? `Продолжить с ${selectedProvider?.name ?? 'хранилищем'}`
    : selectedProvider?.connectLabel ?? `Подключить ${selectedProvider?.name ?? 'хранилище'}`
  const statusLabel = state.sync.status === 'conflict'
    ? 'Нужен выбор'
    : syncing
      ? activeSyncIntent === 'pull'
        ? 'Получение'
        : activeSyncIntent === 'push'
          ? 'Отправка'
          : state.sync.status === 'connecting' ? 'Подключение' : 'Синхронизация'
      : authorizationRequired
        ? 'Нужен вход'
        : state.sync.status === 'error'
          ? 'Ошибка'
        : connected
          ? state.sync.status === 'success' ? 'Синхронизировано' : 'Подключено'
          : 'Отключено'
  const appearanceKey = JSON.stringify({
    theme: state.settings.theme,
    accent: state.settings.accent,
    fontFamily: state.settings.fontFamily,
    fontScale: state.settings.fontScale,
    backgroundPreset: state.settings.backgroundPreset,
    customBackgroundDataUrl: state.settings.customBackgroundDataUrl,
    backgroundDim: state.settings.backgroundDim,
  })
  const backgroundDimMinimum = state.settings.backgroundPreset === 'custom' ? 65 : 10
  const effectiveBackgroundDim = Math.max(backgroundDimMinimum, state.settings.backgroundDim)

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

  useLayoutEffect(() => {
    if (!pendingBackup) return
    backupCancelRef.current?.focus()
    return () => {
      requestAnimationFrame(() => backupImportTriggerRef.current?.focus())
    }
  }, [pendingBackup])

  useLayoutEffect(() => {
    if (confirmDemoReset) resetDemoCancelRef.current?.focus()
  }, [confirmDemoReset])

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
    let dataUrl: string
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    } catch {
      setBackgroundError('Не удалось прочитать изображение')
      return
    }
    if (!safeCustomBackgroundDataUrl(dataUrl)) {
      setBackgroundError('Не удалось безопасно прочитать изображение')
      return
    }
    updateAppearance({ backgroundPreset: 'custom', customBackgroundDataUrl: dataUrl })
    setBackgroundError('')
  }

  const downloadBackup = () => {
    try {
      const backup = createPortableBackup(state)
      const url = URL.createObjectURL(new Blob([backup.contents], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = backup.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setBackupError('')
      setBackupStatus('Резервная копия скачана')
    } catch (error) {
      setBackupStatus('')
      setBackupError(error instanceof PortableBackupError
        ? error.message
        : 'Не удалось подготовить резервную копию. Локальные данные не изменены')
    }
  }

  const previewBackup = async (file?: File) => {
    if (!file) return
    setBackupError('')
    setBackupStatus('')
    try {
      assertPortableBackupFile(file)
      const parsed = parsePortableBackup(await readFileAsText(file))
      setPendingBackup({
        fileName: file.name,
        fileSize: file.size,
        generatedAt: parsed.generatedAt,
        state: parsed.state,
        summary: summarizeSnapshot(parsed.state),
      })
    } catch (error) {
      setPendingBackup(undefined)
      setBackupError(error instanceof PortableBackupError
        ? error.message
        : 'Не удалось прочитать резервную копию. Текущие данные не изменены')
    }
  }

  const confirmBackupImport = async () => {
    if (!pendingBackup) return
    setImportingBackup(true)
    setBackupError('')
    try {
      await importLocalBackup(pendingBackup.state)
      setPendingBackup(undefined)
      setBackupStatus('Резервная копия импортирована. Предыдущие локальные данные сохранены')
    } catch (error) {
      setBackupError(error instanceof Error && error.message.startsWith('Дождитесь')
        ? error.message
        : 'Не удалось сохранить резервную копию. Текущие данные не изменены')
    } finally {
      setImportingBackup(false)
    }
  }

  const restorePreviousBackup = async () => {
    if (restoringBackup) return
    setRestoringBackup(true)
    setBackupError('')
    try {
      const restored = await restoreImportBackup()
      if (restored) {
        setBackupStatus('Предыдущая локальная копия восстановлена')
        setBackupError('')
      } else {
        setBackupStatus('')
        setBackupError('Не удалось восстановить предыдущую копию. Текущие данные не изменены')
      }
    } finally {
      setRestoringBackup(false)
    }
  }

  const confirmResetDemo = async () => {
    if (resetConfirmationBusy) return
    setResettingDemo(true)
    setBackupError('')
    setBackupStatus('')
    try {
      await resetDemo()
      setConfirmDemoReset(false)
      requestAnimationFrame(() => resetDemoTriggerRef.current?.focus())
      setBackupStatus('Демо-данные восстановлены. Предыдущие локальные данные сохранены')
    } catch {
      setBackupError('Не удалось восстановить демо-данные. Текущие данные не изменены')
    } finally {
      setResettingDemo(false)
    }
  }

  const cancelResetDemo = () => {
    setConfirmDemoReset(false)
    requestAnimationFrame(() => resetDemoTriggerRef.current?.focus())
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
            <header><span><Palette /></span><div><h2>Внешний вид</h2><p>Тема, шрифт и визуальный акцент</p></div></header>
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
            <label className="setting-row">
              <div><strong>Шрифт интерфейса</strong><span>Без загрузки внешних файлов</span></div>
              <select
                aria-label="Шрифт интерфейса"
                value={state.settings.fontFamily}
                onChange={(event) => updateAppearance({ fontFamily: event.target.value as AppFontFamily })}
              >
                <option value="system">Системный</option>
                <option value="humanist">Гуманистический</option>
                <option value="readable">Повышенная читаемость</option>
              </select>
            </label>
            <div className="setting-row">
              <div><strong>Размер текста</strong><span>Меняет текст во всём приложении</span></div>
              <div className="segmented font-scale-picker" aria-label="Размер текста">
                {([90, 100, 110, 120] as AppFontScale[]).map((fontScale) => (
                  <button
                    type="button"
                    key={fontScale}
                    className={state.settings.fontScale === fontScale ? 'is-selected' : ''}
                    aria-pressed={state.settings.fontScale === fontScale}
                    aria-label={`Размер текста ${fontScale}%`}
                    onClick={() => updateAppearance({ fontScale })}
                  >
                    {fontScale}%
                  </button>
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
                <button type="button" className={`background-swatch background-swatch--custom ${state.settings.backgroundPreset === 'custom' ? 'is-selected' : ''}`} onClick={() => backgroundRef.current?.click()} aria-label="Загрузить свой фон" aria-pressed={state.settings.backgroundPreset === 'custom'}>
                  {state.settings.customBackgroundDataUrl ? <img src={state.settings.customBackgroundDataUrl} alt="" /> : <Upload size={16} />}
                  <span>Свой</span>
                </button>
                <input ref={backgroundRef} hidden type="file" accept="image/*" onChange={(event) => void readBackground(event.target.files?.[0])} />
              </div>
              {backgroundError && <small className="background-error">{backgroundError}</small>}
            </div>
            {state.settings.backgroundPreset !== 'none' && (
              <label className="setting-row">
                <div><strong>Затемнение фона</strong><span>{state.settings.backgroundPreset === 'custom' ? 'Для своего изображения безопасный минимум — 65%' : 'Чтобы текст и панели оставались читаемыми'}</span></div>
                <span className="background-range"><Image size={15} /><input aria-label="Затемнение фона" type="range" min={backgroundDimMinimum} max="80" step="5" value={effectiveBackgroundDim} onChange={(event) => updateAppearance({ backgroundDim: Number(event.target.value) })} /><em>{effectiveBackgroundDim}%</em></span>
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
              <div><strong>Срочность для новых проектов</strong><span>Порог по умолчанию при создании проекта</span></div>
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
            <div className="sync-actions" aria-busy={syncing}>
              {interactiveSelected && !connected ? (
                <button className="button button--primary" disabled={syncing || missingRequiredConfig} onClick={() => void connectSyncProvider()}>
                  {syncing ? <RefreshCw className="spin" size={17} /> : <Link2 size={17} />}
                  {syncing ? 'Подключение…' : connectLabel}
                </button>
              ) : (
                <>
                  <button
                    className="button button--primary"
                    disabled={syncActionsBlocked}
                    onClick={() => void syncNow()}
                    aria-label={`Синхронизировать данные с ${selectedProvider?.name ?? 'хранилищем'}`}
                  >
                    <RefreshCw className={activeSyncIntent === 'reconcile' ? 'spin' : ''} size={17} />
                    {activeSyncIntent === 'reconcile' ? 'Синхронизация…' : 'Синхронизировать'}
                  </button>
                  {selectedProvider?.capabilities.download && (
                    <button
                      className="button button--ghost"
                      disabled={syncActionsBlocked}
                      onClick={() => void pullFromSyncProvider()}
                      aria-label={`Получить данные из ${selectedProvider.name}`}
                    >
                      <Download size={16} />
                      {activeSyncIntent === 'pull' ? 'Получаем…' : `Получить из «${selectedProvider.name}»`}
                    </button>
                  )}
                  {selectedProvider?.capabilities.upload && (
                    <button
                      className="button button--ghost"
                      disabled={syncActionsBlocked}
                      onClick={() => void pushToSyncProvider()}
                      aria-label={`Отправить локальные данные в ${selectedProvider.name}`}
                    >
                      <Upload size={16} />
                      {activeSyncIntent === 'push' ? 'Отправляем…' : `Отправить в «${selectedProvider.name}»`}
                    </button>
                  )}
                </>
              )}
              {interactiveSelected && connected && (
                <button className="button button--ghost" disabled={syncing} onClick={() => void disconnectSyncProvider()}><LogOut size={16} /> Отключить</button>
              )}
              <button className="button button--ghost" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Скрыть детали' : 'Показать детали'}</button>
            </div>
            {syncConflict && (
              <section className="sync-conflict" role="alert" aria-label="Конфликт синхронизации">
                <header><CircleAlert size={20} /><div><strong>{syncConflict.intent === 'pull'
                  ? 'Удалённая копия отличается от локальной'
                  : syncConflict.intent === 'push'
                    ? 'В хранилище уже есть другая копия'
                    : 'Локальная и удалённая копии различаются'}</strong><span>Ничего не будет перезаписано без вашего выбора.</span></div></header>
                <div className="sync-conflict__compare">
                  <span><strong>Это устройство</strong><small>{syncConflict.local.tasks} задач · {syncConflict.local.projects} проектов · {syncConflict.local.habits} привычек</small><em>{syncConflict.local.recentTaskTitles.join(' · ') || 'Нет задач'}</em></span>
                  <span><strong>Хранилище</strong><small>{syncConflict.remote.tasks} задач · {syncConflict.remote.projects} проектов · {syncConflict.remote.habits} привычек</small><em>{syncConflict.remote.recentTaskTitles.join(' · ') || 'Нет задач'}</em></span>
                </div>
                <div className="sync-conflict__actions">
                  {syncConflict.intent !== 'push' && (
                    <button className="button button--primary" disabled={syncing} onClick={() => void resolveSyncConflict('remote')}><Download size={16} /> Получить копию из хранилища</button>
                  )}
                  {syncConflict.intent !== 'pull' && (!confirmLocalOverwrite ? (
                    <button className="button button--danger-ghost" disabled={syncing} onClick={() => setConfirmLocalOverwrite(true)}>Заменить копию локальными данными</button>
                  ) : (
                    <button className="button button--danger-ghost" disabled={syncing} onClick={() => void resolveSyncConflict('local')}>Точно заменить копию в хранилище</button>
                  ))}
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
            <header><span><Plug /></span><div><h2>Расширения</h2><p>Экспериментальный каркас для разработки</p></div><span className="status-pill">Эксперимент</span></header>
            <div className="plugin-empty"><Sparkles /><div><strong>{plugins.length ? `${plugins.length} встроенных расширений зарегистрировано` : 'Сторонние расширения отключены'}</strong><p>Сейчас доступен только in-process реестр для кода, собранного вместе с приложением.</p></div><button className="button button--ghost" onClick={() => setShowPluginDetails(!showPluginDetails)}>{showPluginDetails ? 'Скрыть' : 'Контракты (внутренние)'} <ExternalLink size={15} /></button></div>
            {showPluginDetails && (
              <div className="plugin-contracts">
                <code>task-actions</code><code>sidebar</code><code>settings</code>
                <p>Это внутренние экспериментальные slots, а не публичный API. Permissions и sandbox ещё не реализованы. Динамическая загрузка стороннего JavaScript отключена.</p>
              </div>
            )}
          </section>

          <section className="settings-card" id="data">
            <header><span><Database /></span><div><h2>Локальные данные</h2><p>Резервные копии, перенос и восстановление</p></div></header>
            {backupStatus && (
              <Toast
                tone="success"
                action={importBackupAvailable && (backupStatus.includes('импортирована') || backupStatus.includes('Демо-данные'))
                  ? { label: backupStatus.includes('Демо-данные') ? 'Отменить сброс' : 'Отменить импорт', disabled: syncing || importingBackup || restoringBackup || resettingDemo, onClick: () => void restorePreviousBackup() }
                  : undefined}
                onClose={() => setBackupStatus('')}
              >
                {backupStatus}
              </Toast>
            )}
            {backupError && !pendingBackup && <p className="backup-message backup-message--error" role="alert"><CircleAlert size={17} /> {backupError}</p>}
            <div className="setting-row">
              <div><strong>Скачать резервную копию</strong><span>Переносимый JSON содержит задачи и вложения без OAuth-настроек; файл не зашифрован — храните его как конфиденциальный</span></div>
              <button type="button" className="button button--ghost" disabled={importingBackup || restoringBackup} onClick={downloadBackup}><Download size={16} /> Скачать JSON</button>
            </div>
            <div className="setting-row">
              <div><strong>Импортировать из файла</strong><span>Сначала покажем содержимое; данные заменятся только после подтверждения</span></div>
              <button
                ref={backupImportTriggerRef}
                type="button"
                className="button button--ghost"
                disabled={syncing || importingBackup || restoringBackup}
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload size={16} /> Выбрать JSON-файл
              </button>
              <input
                ref={backupInputRef}
                hidden
                type="file"
                accept=".json,application/json"
                aria-label="Файл резервной копии"
                disabled={syncing || importingBackup || restoringBackup}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  void previewBackup(file)
                }}
              />
            </div>
            {importBackupAvailable && (
              <div className="setting-row">
                <div><strong>Предыдущая локальная копия</strong><span>Вернуть данные, которые были до последнего импорта; текущая копия останется для повторной отмены</span></div>
                <button type="button" className="button button--ghost" disabled={syncing || importingBackup || restoringBackup} onClick={() => void restorePreviousBackup()}><RotateCcw className={restoringBackup ? 'spin' : undefined} size={16} /> {restoringBackup ? 'Восстанавливаем…' : 'Восстановить'}</button>
              </div>
            )}
            <div className="setting-row">
              <div><strong>Восстановить демо-данные</strong><span>Текущие локальные изменения будут заменены</span></div>
              {confirmDemoReset ? (
                <div
                  className="reset-demo-confirm"
                  role="group"
                  aria-label="Подтверждение сброса демо-данных"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || resetConfirmationBusy) return
                    event.preventDefault()
                    event.stopPropagation()
                    cancelResetDemo()
                  }}
                >
                  <button type="button" className="button button--danger-ghost" disabled={resetConfirmationBusy} onClick={() => void confirmResetDemo()}><RotateCcw className={resettingDemo ? 'spin' : undefined} size={16} /> {resettingDemo ? 'Восстанавливаем…' : 'Точно сбросить'}</button>
                  <button ref={resetDemoCancelRef} type="button" className="button button--ghost" disabled={resetConfirmationBusy} onClick={cancelResetDemo}>Отмена</button>
                </div>
              ) : (
                <button ref={resetDemoTriggerRef} type="button" className="button button--danger-ghost" disabled={resetConfirmationBusy} onClick={() => setConfirmDemoReset(true)}><RotateCcw size={16} /> Сбросить</button>
              )}
            </div>
          </section>
        </div>
      </div>

      {pendingBackup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !importingBackup) setPendingBackup(undefined)
        }}>
          <section
            ref={backupDialogRef}
            className="backup-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-import-title"
            aria-describedby="backup-import-description"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !importingBackup) {
                event.preventDefault()
                setPendingBackup(undefined)
                return
              }
              trapTabKey(event, backupDialogRef.current)
            }}
          >
            <header>
              <span><Upload size={20} /></span>
              <div>
                <h2 id="backup-import-title">Импортировать резервную копию?</h2>
                <p id="backup-import-description">Текущие локальные данные будут заменены. Перед импортом Focus Flow сохранит их для восстановления.</p>
              </div>
            </header>
            <div className="backup-import-dialog__content">
              <dl className="backup-import-file">
                <div><dt>Файл</dt><dd>{pendingBackup.fileName}</dd></div>
                <div><dt>Размер</dt><dd>{formatFileSize(pendingBackup.fileSize)}</dd></div>
                {pendingBackup.generatedAt && <div><dt>Создан</dt><dd>{formatBackupDate(pendingBackup.generatedAt)}</dd></div>}
              </dl>
              <div className="backup-import-summary" aria-label="Содержимое резервной копии">
                <span><strong>{pendingBackup.summary.tasks}</strong> задач</span>
                <span><strong>{pendingBackup.summary.projects}</strong> проектов</span>
                <span><strong>{pendingBackup.summary.habits}</strong> привычек</span>
                <span><strong>{pendingBackup.summary.savedFilters}</strong> фильтров</span>
              </div>
              {pendingBackup.summary.recentTaskTitles.length > 0 && (
                <div className="backup-import-recent">
                  <strong>Недавние задачи</strong>
                  <ul>{pendingBackup.summary.recentTaskTitles.map((title, index) => <li key={`${index}:${title}`}>{title}</li>)}</ul>
                </div>
              )}
              {backupError && <p className="backup-message backup-message--error" role="alert"><CircleAlert size={17} /> {backupError}</p>}
            </div>
            <footer>
              <button ref={backupCancelRef} type="button" className="button button--ghost" disabled={importingBackup} onClick={() => setPendingBackup(undefined)}>Отмена</button>
              <button type="button" className="button button--danger-ghost" disabled={importingBackup} onClick={() => void confirmBackupImport()}>
                {importingBackup ? <><RefreshCw className="spin" size={16} /> Импортируем…</> : <><Upload size={16} /> Импортировать и заменить</>}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsText(file)
  })
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

function formatBackupDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'неизвестно' : date.toLocaleString('ru-RU')
}
