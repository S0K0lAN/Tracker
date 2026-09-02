fn main() {
    let attributes = tauri_build::Attributes::new()
        .plugin(
            "android-window",
            tauri_build::InlinedPlugin::new()
                .commands(&["safe_area_insets", "set_system_bar_appearance"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "file-export",
            tauri_build::InlinedPlugin::new()
                .commands(&["save_file", "open_file"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "google-authorization",
            tauri_build::InlinedPlugin::new()
                .commands(&["authorize", "disconnect"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        )
        .plugin(
            "speech-recognition",
            tauri_build::InlinedPlugin::new()
                .commands(&["recognize"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        );

    tauri_build::try_build(attributes).expect("failed to build Focus Flow Tauri application");
}
