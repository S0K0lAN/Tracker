use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

const PLUGIN_NAME: &str = "speech-recognition";

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum RecognitionResponse {
    Recognized { transcript: String },
    Cancelled,
}

#[derive(Debug, Serialize)]
pub struct SpeechRecognitionError {
    code: &'static str,
    message: String,
}

impl SpeechRecognitionError {
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
                    Some("cancel") => "cancel",
                    Some("no-activity") => "no-activity",
                    Some("no-match") => "no-match",
                    _ => "unavailable",
                };
                Self {
                    code,
                    message: response
                        .message
                        .unwrap_or_else(|| "Speech recognition failed".to_string()),
                }
            }
            other => Self::unavailable(other.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Clone)]
struct AndroidSpeechRecognition<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Serialize)]
struct RecognitionRequest {
    locale: String,
}

#[tauri::command]
async fn recognize<R: Runtime>(
    app: AppHandle<R>,
    locale: String,
) -> Result<RecognitionResponse, SpeechRecognitionError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidSpeechRecognition<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| {
                SpeechRecognitionError::unavailable("Speech recognition is not initialized")
            })?;

        return plugin
            .run_mobile_plugin_async("recognize", RecognitionRequest { locale })
            .await
            .map_err(SpeechRecognitionError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, locale);
        Err(SpeechRecognitionError::unavailable(
            "Native speech recognition is only available on Android",
        ))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![recognize])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;

                let handle = api.register_android_plugin(
                    "io.github.s0k0lan.focusflow",
                    "SpeechRecognitionPlugin",
                )?;
                app.manage(AndroidSpeechRecognition(handle));
            }

            #[cfg(not(target_os = "android"))]
            let _ = (app, api);

            Ok(())
        })
        .build()
}
