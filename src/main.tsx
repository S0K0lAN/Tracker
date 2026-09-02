import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { createDefaultStorageAdapter } from './core/storage/createDefaultStorageAdapter'
import { AppProvider } from './state/AppContext'
import { RouterProvider } from './core/router/Router'
import { installAndroidSafeAreaFallback } from './core/mobile/AndroidSafeArea'
import { installMobileThemeChrome } from './core/mobile/MobileThemeChrome'
import './styles.css'

const storageAdapter = createDefaultStorageAdapter()
const disposeAndroidSafeAreaFallback = installAndroidSafeAreaFallback()
const disposeMobileThemeChrome = installMobileThemeChrome()

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposeAndroidSafeAreaFallback()
  disposeMobileThemeChrome()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider>
      <AppProvider storageAdapter={storageAdapter}>
        <App />
      </AppProvider>
    </RouterProvider>
  </React.StrictMode>,
)
