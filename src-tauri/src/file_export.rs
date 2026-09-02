use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

const PLUGIN_NAME: &str = "file-export";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileResponse {
    status: SaveFileStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum SaveFileStatus {
    Saved,
    Cancelled,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OpenFileResponse {
    status: OpenFileStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum OpenFileStatus {
    Opened,
}

#[derive(Debug, Serialize)]
pub struct FileExportError {
    code: &'static str,
    message: String,
}

impl FileExportError {
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
                    Some("busy") => "busy",
                    Some("invalid-base64") => "invalid-base64",
                    Some("invalid-file-name") => "invalid-file-name",
                    Some("invalid-mime-type") => "invalid-mime-type",
                    Some("no-activity") => "no-activity",
                    Some("payload-too-large") => "payload-too-large",
                    Some("write-failed") => "write-failed",
                    _ => "unavailable",
                };
                Self {
                    code,
                    message: response
                        .message
                        .unwrap_or_else(|| "File export failed".to_string()),
                }
            }
            other => Self::unavailable(other.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Clone)]
struct AndroidFileExport<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    file_name: String,
    mime_type: String,
    base64_data: String,
}

#[tauri::command]
async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    mime_type: String,
    base64_data: String,
) -> Result<SaveFileResponse, FileExportError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidFileExport<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| FileExportError::unavailable("File export is not initialized"))?;

        return plugin
            .run_mobile_plugin_async(
                "saveFile",
                SaveFileRequest {
                    file_name,
                    mime_type,
                    base64_data,
                },
            )
            .await
            .map_err(FileExportError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, file_name, mime_type, base64_data);
        Err(FileExportError::unavailable(
            "Native file export is only available on Android",
        ))
    }
}

#[tauri::command]
async fn open_file<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    mime_type: String,
    base64_data: String,
) -> Result<OpenFileResponse, FileExportError> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;

        let plugin = app
            .try_state::<AndroidFileExport<R>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| FileExportError::unavailable("File export is not initialized"))?;

        return plugin
            .run_mobile_plugin_async(
                "openFile",
                SaveFileRequest {
                    file_name,
                    mime_type,
                    base64_data,
                },
            )
            .await
            .map_err(FileExportError::from_plugin);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, file_name, mime_type, base64_data);
        Err(FileExportError::unavailable(
            "Native file preview is only available on Android",
        ))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![save_file, open_file])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;

                let handle =
                    api.register_android_plugin("io.github.s0k0lan.focusflow", "FileExportPlugin")?;
                app.manage(AndroidFileExport(handle));
            }

            #[cfg(not(target_os = "android"))]
            let _ = (app, api);

            Ok(())
        })
        .build()
}
