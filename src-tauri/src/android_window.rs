use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

const PLUGIN_NAME: &str = "android-window";

#[derive(Debug, Deserialize, Serialize)]
pub struct SafeAreaInsets {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

#[derive(Debug, Serialize)]
pub struct AndroidWindowError {
    code: &'static str,
    message: String,
}

impl AndroidWindowError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable",
            message: message.into(),
        }
    }

    #[cfg(target_os = "android")]
    fn from_plugin(error: tauri::plugin::mobile::PluginInvokeError) -> Self {
        match error {
            tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) => Self {
                code: "unavailable",
                message: response
                    .message
                    .unwrap_or_else(|| "Android window insets are unavailable".to_string()),
            },
            other => Self::unavailable(other.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Clone)]
struct AndroidWindow<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn safe_area_insets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SafeAreaInsets, AndroidWindowError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidWindow<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| AndroidWindowError::unavailable("Android window is not initialized"))?;

        return plugin
            .run_mobile_plugin_async("safeAreaInsets", ())
            .await
            .map_err(AndroidWindowError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(AndroidWindowError::unavailable(
            "Android window insets are only available on Android",
        ))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemBarAppearanceRequest {
    dark_theme: bool,
}

#[tauri::command]
async fn set_system_bar_appearance<R: Runtime>(
    app: AppHandle<R>,
    dark_theme: bool,
) -> Result<(), AndroidWindowError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidWindow<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| AndroidWindowError::unavailable("Android window is not initialized"))?;

        return plugin
            .run_mobile_plugin_async(
                "setSystemBarAppearance",
                SystemBarAppearanceRequest { dark_theme },
            )
            .await
            .map_err(AndroidWindowError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, dark_theme);
        Err(AndroidWindowError::unavailable(
            "System bar appearance is only available on Android",
        ))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![
            safe_area_insets,
            set_system_bar_appearance
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;

                let handle = api.register_android_plugin(
                    "io.github.s0k0lan.focusflow",
                    "AndroidWindowPlugin",
                )?;
                app.manage(AndroidWindow(handle));
            }

            #[cfg(not(target_os = "android"))]
            let _ = (app, api);

            Ok(())
        })
        .build()
}
