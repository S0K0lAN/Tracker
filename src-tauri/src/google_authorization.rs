use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

const PLUGIN_NAME: &str = "google-authorization";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationResponse {
    access_token: String,
    expires_at: u64,
}

#[derive(Debug, Serialize)]
pub struct AuthorizationError {
    code: &'static str,
    message: String,
}

impl AuthorizationError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable",
            message: message.into(),
        }
    }

    #[cfg(target_os = "android")]
    fn from_plugin(error: tauri::plugin::mobile::PluginInvokeError) -> Self {
        match error {
            tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) => {
                let code = match response.code.as_deref() {
                    Some("access-denied") => "access-denied",
                    Some("cancel") => "cancel",
                    Some("config") => "config",
                    Some("unavailable") => "unavailable",
                    _ => "unavailable",
                };
                Self {
                    code,
                    message: response
                        .message
                        .unwrap_or_else(|| "Google authorization failed".to_string()),
                }
            }
            other => Self::unavailable(other.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Clone)]
struct AndroidAuthorization<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn authorize<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AuthorizationResponse, AuthorizationError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidAuthorization<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| {
                AuthorizationError::unavailable("Google authorization is not initialized")
            })?;

        return plugin
            .run_mobile_plugin_async("authorize", ())
            .await
            .map_err(AuthorizationError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(AuthorizationError::unavailable(
            "Native Google authorization is only available on Android",
        ))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectRequest {
    access_token: String,
}

#[tauri::command]
async fn disconnect<R: Runtime>(
    app: AppHandle<R>,
    access_token: String,
) -> Result<(), AuthorizationError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        if access_token.trim().is_empty() {
            return Err(AuthorizationError {
                code: "config",
                message: "An access token is required to clear authorization".to_string(),
            });
        }

        let plugin = app
            .try_state::<AndroidAuthorization<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| {
                AuthorizationError::unavailable("Google authorization is not initialized")
            })?;

        return plugin
            .run_mobile_plugin_async("disconnect", DisconnectRequest { access_token })
            .await
            .map_err(AuthorizationError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, access_token);
        Err(AuthorizationError::unavailable(
            "Native Google authorization is only available on Android",
        ))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![authorize, disconnect])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;

                let handle = api.register_android_plugin(
                    "io.github.s0k0lan.focusflow",
                    "GoogleAuthorizationPlugin",
                )?;
                app.manage(AndroidAuthorization(handle));
            }

            #[cfg(not(target_os = "android"))]
            let _ = (app, api);

            Ok(())
        })
        .build()
}
