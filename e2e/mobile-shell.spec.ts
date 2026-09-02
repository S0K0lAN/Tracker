import { expect, test, type Page } from './fixtures'

const STORAGE_KEY = 'focus-flow.state.v1'
const ROUTES = ['/today', '/inbox', '/projects', '/calendar', '/matrix', '/search', '/habits', '/trash', '/settings'] as const

async function waitForLocalState(page: Page) {
  await page.waitForFunction((storageKey) => Boolean(localStorage.getItem(storageKey)), STORAGE_KEY)
}

async function applySafeArea(
  page: Page,
  insets: { top: number; right: number; bottom: number; left: number },
) {
  await page.evaluate(({ top, right, bottom, left }) => {
    const root = document.documentElement
    root.style.setProperty('--safe-area-top', `${top}px`)
    root.style.setProperty('--safe-area-right', `${right}px`)
    root.style.setProperty('--safe-area-bottom', `${bottom}px`)
    root.style.setProperty('--safe-area-left', `${left}px`)
  }, insets)
}

async function expectCalendarTargets(page: Page) {
  const mode = (name: 'Год' | 'Месяц' | 'Неделя' | '3 дня' | 'День') => (
    page.locator('.calendar-view-switcher').getByRole('button', { name, exact: true })
  )

  await mode('Год').click()
  const yearDates = await page.locator('.year-month__days > button').first().evaluate((button) => {
    const box = button.getBoundingClientRect()
    return { width: box.width, height: box.height }
  })
  expect(yearDates.width).toBeGreaterThanOrEqual(44)
  expect(yearDates.height).toBeGreaterThanOrEqual(44)

  await mode('Месяц').click()
  const monthDayOpener = await page.locator('.month-day__number').first().boundingBox()
  expect(monthDayOpener).not.toBeNull()
  expect(monthDayOpener!.width).toBeGreaterThanOrEqual(44)
  expect(monthDayOpener!.height).toBeGreaterThanOrEqual(44)
  const monthEntries = page.locator('.month-day__task, .month-calendar__range')
  expect(await monthEntries.count()).toBeGreaterThan(0)
  expect(await monthEntries.evaluateAll((entries) => entries.every((entry) => entry.getBoundingClientRect().height >= 24))).toBe(true)

  for (const name of ['Неделя', '3 дня', 'День'] as const) {
    await mode(name).click()
    const headers = page.locator('.week-day__header')
    expect(await headers.count()).toBeGreaterThan(0)
    expect(await headers.evaluateAll((items) => items.every((item) => {
      const box = item.getBoundingClientRect()
      return box.width >= 44 && box.height >= 44
    }))).toBe(true)

    const entries = page.locator('.calendar-task, .time-calendar__all-day-range')
    expect(await entries.count()).toBeGreaterThan(0)
    expect(await entries.evaluateAll((items) => items.every((item) => item.getBoundingClientRect().height >= 24))).toBe(true)
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/inbox')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await waitForLocalState(page)
})

test('Android portrait keeps system insets, compact visuals and usable touch areas', async ({ page }) => {
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2)

  await applySafeArea(page, { top: 24, right: 6, bottom: 24, left: 6 })
  const shell = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.mobile-header')!
    const workspace = document.querySelector<HTMLElement>('.workspace')!
    const nav = document.querySelector<HTMLElement>('.bottom-nav')!
    const headerBox = header.getBoundingClientRect()
    const navBox = nav.getBoundingClientRect()
    return {
      headerTop: headerBox.top,
      headerHeight: headerBox.height,
      workspacePaddingTop: Number.parseFloat(getComputedStyle(workspace).paddingTop),
      navBottomGap: innerHeight - navBox.bottom,
      navItems: [...nav.querySelectorAll<HTMLElement>('a')].map((item) => {
        const box = item.getBoundingClientRect()
        return { width: box.width, height: box.height }
      }),
    }
  })
  expect(shell.headerTop).toBe(0)
  expect(shell.headerHeight).toBeGreaterThanOrEqual(82)
  expect(shell.workspacePaddingTop).toBeGreaterThanOrEqual(82)
  expect(shell.navBottomGap).toBeGreaterThanOrEqual(30)
  expect(shell.navItems.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)

  const expandedHeaderHitArea = await page.getByRole('button', { name: 'Открыть меню' }).evaluate((button) => {
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left - 3, box.top + box.height / 2)
    return hit === button || button.contains(hit)
  })
  expect(expandedHeaderHitArea).toBe(true)

  await page.getByRole('button', { name: 'Быстро создать задачу' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const safeFooterPadding = await page.locator('.task-editor__footer').evaluate((footer) => (
    Number.parseFloat(getComputedStyle(footer).paddingBottom)
  ))
  expect(safeFooterPadding).toBeGreaterThanOrEqual(32)

  // Headless Chrome cannot show Android's IME. Shrinking the visual viewport
  // exercises the same dvh path used when modern WebView resizes for it.
  await page.setViewportSize({ width: 412, height: 560 })
  const imeLayout = await page.locator('.task-editor').evaluate((dialog) => {
    const dialogBox = dialog.getBoundingClientRect()
    const footerBox = dialog.querySelector('footer')!.getBoundingClientRect()
    return {
      dialogTop: dialogBox.top,
      dialogBottom: dialogBox.bottom,
      footerBottom: footerBox.bottom,
      viewportHeight: window.visualViewport?.height ?? innerHeight,
    }
  })
  expect(imeLayout.dialogTop).toBeGreaterThanOrEqual(24)
  expect(imeLayout.dialogBottom).toBeLessThanOrEqual(imeLayout.viewportHeight + 1)
  expect(imeLayout.footerBottom).toBeLessThanOrEqual(imeLayout.viewportHeight + 1)
  await page.getByRole('button', { name: 'Закрыть редактор' }).click()

  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/settings')
  await applySafeArea(page, { top: 24, right: 6, bottom: 24, left: 6 })
  const accentTargets = await page.locator('.accent-picker button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect()
    const swatch = getComputedStyle(button, '::before')
    return {
      width: box.width,
      height: box.height,
      swatchWidth: Number.parseFloat(swatch.width),
      swatchHeight: Number.parseFloat(swatch.height),
    }
  }))
  expect(accentTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  expect(accentTargets.every(({ swatchWidth, swatchHeight }) => swatchWidth === 29 && swatchHeight === 29)).toBe(true)

  await page.goto('/habits')
  const habitTarget = await page.getByRole('button', { name: /Отметить Пить воду|Отменить Пить воду/ }).first().boundingBox()
  expect(habitTarget).not.toBeNull()
  expect(habitTarget!.width).toBeGreaterThanOrEqual(44)
  expect(habitTarget!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('Android landscape remains in the mobile shell without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 })
  await page.goto('/inbox')
  await waitForLocalState(page)
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey)!)
    state.settings.fontScale = 120
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, STORAGE_KEY)
  await page.reload()

  for (const path of ROUTES) {
    await page.goto(path)
    await applySafeArea(page, { top: 4, right: 8, bottom: 20, left: 28 })
    await expect(page.locator('.workspace main h1').first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `${path} overflows horizontally in Android landscape`,
    ).toBe(true)
  }

  await page.goto('/inbox')
  await applySafeArea(page, { top: 4, right: 8, bottom: 20, left: 28 })
  const landscapeShell = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.mobile-header')!
    const nav = document.querySelector<HTMLElement>('.bottom-nav')!
    const sidebar = document.querySelector<HTMLElement>('.sidebar')!
    const workspace = document.querySelector<HTMLElement>('.workspace')!
    const page = document.querySelector<HTMLElement>('.page')!
    const pageBox = page.getBoundingClientRect()
    return {
      headerDisplay: getComputedStyle(header).display,
      navDisplay: getComputedStyle(nav).display,
      workspaceMarginLeft: Number.parseFloat(getComputedStyle(workspace).marginLeft),
      sidebarRight: sidebar.getBoundingClientRect().right,
      globalAddDisplay: getComputedStyle(document.querySelector<HTMLElement>('.global-add')!).display,
      pageLeft: pageBox.left,
      pageRightGap: innerWidth - pageBox.right,
    }
  })
  expect(landscapeShell.headerDisplay).toBe('flex')
  expect(landscapeShell.navDisplay).toBe('grid')
  expect(landscapeShell.workspaceMarginLeft).toBe(0)
  expect(landscapeShell.sidebarRight).toBeLessThanOrEqual(0)
  expect(landscapeShell.globalAddDisplay).toBe('none')
  expect(landscapeShell.pageLeft).toBeGreaterThanOrEqual(28)
  expect(landscapeShell.pageRightGap).toBeGreaterThanOrEqual(8)

  const sidebar = page.locator('.sidebar')
  await expect(sidebar).toHaveAttribute('inert', '')
  const menuOpener = page.getByRole('button', { name: 'Открыть меню' })
  await menuOpener.click()
  await expect(sidebar).not.toHaveAttribute('inert', '')
  await expect(sidebar).toHaveAttribute('role', 'dialog')
  await expect(sidebar).toHaveAttribute('aria-modal', 'true')
  await expect(page.getByRole('button', { name: 'Закрыть меню', exact: true }).last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sidebar).toHaveAttribute('inert', '')
  await expect(menuOpener).toBeFocused()

  const taskMenuTrigger = page.getByRole('button', { name: /^Действия задачи / }).first()
  const taskTriggerBox = await taskMenuTrigger.boundingBox()
  expect(taskTriggerBox).not.toBeNull()
  expect(Math.round(taskTriggerBox!.width)).toBeGreaterThanOrEqual(44)
  expect(Math.round(taskTriggerBox!.height)).toBeGreaterThanOrEqual(44)
  await taskMenuTrigger.click()
  const taskMenuTargets = await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect()
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      minHeight: Number.parseFloat(getComputedStyle(item).minHeight),
    }
  }))
  expect(taskMenuTargets.every(({ width, height, minHeight }) => width >= 44 && height >= 44 && minHeight >= 44)).toBe(true)

  await page.goto('/projects')
  const projectMenuTrigger = page.getByRole('button', { name: /^Действия проекта / }).first()
  const projectTriggerBox = await projectMenuTrigger.boundingBox()
  expect(projectTriggerBox).not.toBeNull()
  expect(projectTriggerBox!.width).toBeGreaterThanOrEqual(44)
  expect(projectTriggerBox!.height).toBeGreaterThanOrEqual(44)
  await projectMenuTrigger.click()
  const projectMenuTargets = await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect()
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      minHeight: Number.parseFloat(getComputedStyle(item).minHeight),
    }
  }))
  expect(projectMenuTargets.every(({ width, height, minHeight }) => width >= 44 && height >= 44 && minHeight >= 44)).toBe(true)
})

test('calendar day and task targets stay usable in Android portrait and landscape', async ({ page }) => {
  for (const viewport of [{ width: 412, height: 915 }, { width: 915, height: 412 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible()
    await expectCalendarTargets(page)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `calendar overflows at ${viewport.width}x${viewport.height}`,
    ).toBe(true)
  }
})
