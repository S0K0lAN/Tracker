import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`Browser console error: ${message.text()}`)
  })
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => localStorage.getItem('focus-flow.state.v1'))
})

test('light and dark themes keep WCAG AA text contrast on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  const paths = ['/inbox', '/calendar', '/matrix', '/habits', '/settings'] as const
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      const raw = localStorage.getItem('focus-flow.state.v1')
      if (!raw) throw new Error('Local state was not initialized')
      const state = JSON.parse(raw)
      state.settings.theme = selectedTheme
      localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    }, theme)

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      for (const path of paths) {
        await page.goto(path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
        expect(results.violations, `${theme} ${viewport.name} ${path}: ${JSON.stringify(results.violations)}`).toEqual([])
        const hasHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(hasHorizontalOverflow, `${theme} ${viewport.name} ${path} has horizontal overflow`).toBe(false)
      }
    }
  }

  await testInfo.attach('dark-settings-mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})

test('long task list scroll keeps frame pacing responsive', async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const raw = localStorage.getItem('focus-flow.state.v1')
    if (!raw) throw new Error('Local state was not initialized')
    const state = JSON.parse(raw)
    const template = state.tasks.find((task: { status: string }) => task.status === 'active')
    state.tasks = Array.from({ length: 500 }, (_, index) => ({
      ...template,
      id: `perf-${index}`,
      title: `Задача производительности ${index + 1}`,
      projectId: 'inbox',
      startAt: undefined,
      deadline: undefined,
      description: index % 3 === 0 ? 'Проверка плавности длинного списка без тяжёлых эффектов.' : '',
      tags: index % 2 === 0 ? ['фокус', 'нагрузка'] : ['нагрузка'],
      createdAt: new Date(1_785_360_000_000 + index).toISOString(),
      updatedAt: new Date(1_785_360_000_000 + index).toISOString(),
    }))
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
  })

  const startedAt = performance.now()
  await page.reload()
  await expect(page.getByText('Задача производительности 500', { exact: true })).toBeVisible()
  await expect(page.getByText('500', { exact: true }).first()).toBeVisible()
  const renderMs = performance.now() - startedAt

  const frames = await page.evaluate(async () => {
    const gaps: number[] = []
    let previous = performance.now()
    const distance = document.documentElement.scrollHeight - innerHeight
    const started = previous

    while (performance.now() - started < 1_200) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const current = performance.now()
      gaps.push(current - previous)
      previous = current
      const progress = Math.min(1, (current - started) / 1_200)
      scrollTo(0, distance * progress)
    }

    return gaps.sort((a, b) => a - b)
  })

  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0
  const longFrameRatio = frames.filter((gap) => gap > 50).length / Math.max(1, frames.length)
  const metrics = {
    renderMs: Math.round(renderMs),
    p95FrameMs: Number(p95.toFixed(1)),
    longFramePercent: Number((longFrameRatio * 100).toFixed(1)),
    sampledFrames: frames.length,
  }
  await testInfo.attach('scroll-performance.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  })
  console.info(`500-task scroll metrics: ${JSON.stringify(metrics)}`)
  await expect(page.getByText('Задача производительности 1', { exact: true })).toBeVisible()
  expect(renderMs).toBeLessThan(2_000)
  expect(p95).toBeLessThan(40)
  expect(longFrameRatio).toBeLessThan(0.08)
})
