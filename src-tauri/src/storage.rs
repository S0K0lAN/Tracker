use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const NATIVE_FORMAT: &str = "focus-flow-native";
const NATIVE_FORMAT_VERSION: u32 = 1;
const PRIMARY_FILE: &str = "focus-flow-data.json";
const BACKUP_FILE: &str = "focus-flow-data.json.bak";
const IMPORT_BACKUP_FILE: &str = "focus-flow-data.import-backup.json";
const ATTACHMENTS_DIR: &str = "attachments";
const QUARANTINE_DIR: &str = "quarantine";
const MAX_STATE_JSON_BYTES: usize = 12 * 1024 * 1024;
const MAX_NATIVE_JSON_BYTES: usize = 12 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 1_000_000;
const MAX_ATTACHMENT_DATA_URL_BYTES: usize = 1_400_000;
const MAX_TOTAL_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_REFS: usize = 100_000;

static STORAGE_LOCK: Mutex<()> = Mutex::new(());
static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageSlot {
    Primary,
    Backup,
    ImportBackup,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageCommitMode {
    Save,
    ReplaceWithBackup,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCommandError {
    pub code: String,
    pub message: String,
}

impl StorageCommandError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn io(context: &str, error: io::Error) -> Self {
        Self::new("io", format!("{context}: {error}"))
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid-data", message)
    }

    fn too_large(message: impl Into<String>) -> Self {
        Self::new("too-large", message)
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self::new("unsupported-version", message)
    }
}

type StorageResult<T> = Result<T, StorageCommandError>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSnapshot {
    format: String,
    format_version: u32,
    state: Value,
    attachment_refs: Vec<NativeAttachmentRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAttachmentRef {
    task_id: String,
    attachment_id: String,
    content_hash: String,
}

struct EncodedSnapshot {
    document: Vec<u8>,
    blobs: HashMap<String, Vec<u8>>,
}

pub struct StorageService {
    root: PathBuf,
}

impl StorageService {
    fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn read(&self, slot: StorageSlot) -> StorageResult<Option<String>> {
        self.ensure_root()?;
        self.cleanup_temporary_files()?;
        let Some(raw) = read_optional_limited(&self.slot_path(slot), MAX_NATIVE_JSON_BYTES)? else {
            return Ok(None);
        };
        self.hydrate_document(&raw).map(Some)
    }

    fn commit(&self, mode: StorageCommitMode, state_json: &str) -> StorageResult<()> {
        self.ensure_root()?;
        self.cleanup_temporary_files()?;
        let encoded = self.externalize_state(state_json)?;
        self.persist_blobs(&encoded.blobs)?;

        let primary_path = self.slot_path(StorageSlot::Primary);
        let backup_path = self.slot_path(StorageSlot::Backup);
        let import_backup_path = self.slot_path(StorageSlot::ImportBackup);
        let previous_primary = read_optional_limited(&primary_path, MAX_NATIVE_JSON_BYTES)?;
        let previous_backup = read_optional_limited(&backup_path, MAX_NATIVE_JSON_BYTES)?;
        let previous_import_backup =
            read_optional_limited(&import_backup_path, MAX_NATIVE_JSON_BYTES)?;

        let write_result = (|| {
            if let Some(previous) = previous_primary.as_deref() {
                write_atomic(&backup_path, previous)?;
                if matches!(mode, StorageCommitMode::ReplaceWithBackup) {
                    write_atomic(&import_backup_path, previous)?;
                }
            }
            write_atomic(&primary_path, &encoded.document)
        })();

        if let Err(error) = write_result {
            // The primary is replaced last. If any prior stage fails, restore the
            // auxiliary slots best-effort so a failed import does not consume the
            // user's previous undo point.
            let _ = restore_optional_file(&backup_path, previous_backup.as_deref());
            if matches!(mode, StorageCommitMode::ReplaceWithBackup) {
                let _ =
                    restore_optional_file(&import_backup_path, previous_import_backup.as_deref());
            }
            return Err(error);
        }

        // Garbage collection cannot invalidate an otherwise durable commit.
        // Keeping an orphan is safer than reporting a failed save after primary
        // replacement or deleting recovery material.
        let _ = self.collect_unreferenced_blobs();
        Ok(())
    }

    fn recover_primary_from_backup(&self) -> StorageResult<()> {
        self.ensure_root()?;
        let backup_path = self.slot_path(StorageSlot::Backup);
        let backup = read_optional_limited(&backup_path, MAX_NATIVE_JSON_BYTES)?
            .ok_or_else(|| StorageCommandError::invalid("Regular backup is missing"))?;
        // Validate and hydrate before allowing the backup to become authoritative.
        self.hydrate_document(&backup)?;
        write_atomic(&self.slot_path(StorageSlot::Primary), &backup)
    }

    fn quarantine(&self, slot: StorageSlot) -> StorageResult<bool> {
        self.ensure_root()?;
        let source = self.slot_path(slot);
        if !source.exists() {
            return Ok(false);
        }
        let quarantine_dir = self.root.join(QUARANTINE_DIR);
        fs::create_dir_all(&quarantine_dir).map_err(|error| {
            StorageCommandError::io("Cannot create quarantine directory", error)
        })?;
        let target = quarantine_dir.join(format!(
            "{}.{}.{}.corrupt.json",
            slot_label(slot),
            unix_millis(),
            UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::rename(&source, &target)
            .map_err(|error| StorageCommandError::io("Cannot quarantine snapshot", error))?;
        sync_directory(&self.root)?;
        sync_directory(&quarantine_dir)?;
        Ok(true)
    }

    fn clear(&self) -> StorageResult<()> {
        self.ensure_root()?;
        for slot in [
            StorageSlot::Primary,
            StorageSlot::Backup,
            StorageSlot::ImportBackup,
        ] {
            remove_if_exists(&self.slot_path(slot))?;
        }
        remove_dir_all_if_exists(&self.root.join(ATTACHMENTS_DIR))?;
        remove_dir_all_if_exists(&self.root.join(QUARANTINE_DIR))?;
        self.cleanup_temporary_files()?;
        sync_directory(&self.root)
    }

    fn ensure_root(&self) -> StorageResult<()> {
        fs::create_dir_all(&self.root)
            .map_err(|error| StorageCommandError::io("Cannot create app data directory", error))
    }

    fn slot_path(&self, slot: StorageSlot) -> PathBuf {
        self.root.join(match slot {
            StorageSlot::Primary => PRIMARY_FILE,
            StorageSlot::Backup => BACKUP_FILE,
            StorageSlot::ImportBackup => IMPORT_BACKUP_FILE,
        })
    }

    fn externalize_state(&self, state_json: &str) -> StorageResult<EncodedSnapshot> {
        if state_json.len() > MAX_STATE_JSON_BYTES {
            return Err(StorageCommandError::too_large(
                "Hydrated state exceeds the native storage limit",
            ));
        }
        let mut state: Value = serde_json::from_str(state_json).map_err(|error| {
            StorageCommandError::invalid(format!("State is not valid JSON: {error}"))
        })?;
        let tasks = state
            .get_mut("tasks")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| StorageCommandError::invalid("State.tasks must be an array"))?;

        let mut refs = Vec::new();
        let mut identities = HashSet::new();
        let mut blobs: HashMap<String, Vec<u8>> = HashMap::new();
        let mut total_attachment_bytes = 0usize;

        for task in tasks {
            let task = task
                .as_object_mut()
                .ok_or_else(|| StorageCommandError::invalid("Task must be an object"))?;
            let task_id = required_identifier(task.get("id"), "Task.id")?;
            let attachments = task
                .get_mut("attachments")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| StorageCommandError::invalid("Task.attachments must be an array"))?;

            for attachment in attachments {
                let attachment = attachment
                    .as_object_mut()
                    .ok_or_else(|| StorageCommandError::invalid("Attachment must be an object"))?;
                let attachment_id = required_identifier(attachment.get("id"), "Attachment.id")?;
                let identity = (task_id.clone(), attachment_id.clone());
                if !identities.insert(identity.clone()) {
                    return Err(StorageCommandError::invalid(
                        "Duplicate task/attachment identity",
                    ));
                }
                let Some(data_url_value) = attachment.remove("dataUrl") else {
                    continue;
                };
                let data_url = data_url_value.as_str().ok_or_else(|| {
                    StorageCommandError::invalid("Attachment.dataUrl must be a string")
                })?;
                let declared_mime =
                    attachment
                        .get("type")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StorageCommandError::invalid("Attachment.type must be a string")
                        })?;
                let bytes = decode_attachment_data_url(data_url, declared_mime)?;
                total_attachment_bytes = total_attachment_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(|| StorageCommandError::too_large("Attachment size overflow"))?;
                if total_attachment_bytes > MAX_TOTAL_ATTACHMENT_BYTES {
                    return Err(StorageCommandError::too_large(
                        "Attachments exceed the native storage limit",
                    ));
                }
                let content_hash = sha256_hex(&bytes);
                if let Some(existing) = blobs.get(&content_hash) {
                    if existing != &bytes {
                        return Err(StorageCommandError::invalid(
                            "Attachment content hash collision",
                        ));
                    }
                } else {
                    blobs.insert(content_hash.clone(), bytes);
                }
                refs.push(NativeAttachmentRef {
                    task_id: identity.0,
                    attachment_id: identity.1,
                    content_hash,
                });
                if refs.len() > MAX_ATTACHMENT_REFS {
                    return Err(StorageCommandError::too_large(
                        "Too many attachment references",
                    ));
                }
            }
        }

        let snapshot = NativeSnapshot {
            format: NATIVE_FORMAT.into(),
            format_version: NATIVE_FORMAT_VERSION,
            state,
            attachment_refs: refs,
        };
        let document = serde_json::to_vec(&snapshot).map_err(|error| {
            StorageCommandError::invalid(format!("Cannot serialize native snapshot: {error}"))
        })?;
        if document.len() > MAX_NATIVE_JSON_BYTES {
            return Err(StorageCommandError::too_large(
                "Native snapshot exceeds the storage limit",
            ));
        }
        Ok(EncodedSnapshot { document, blobs })
    }

    fn hydrate_document(&self, raw: &[u8]) -> StorageResult<String> {
        if raw.len() > MAX_NATIVE_JSON_BYTES {
            return Err(StorageCommandError::too_large(
                "Native snapshot exceeds the storage limit",
            ));
        }
        let parsed: Value = serde_json::from_slice(raw).map_err(|error| {
            StorageCommandError::invalid(format!("Snapshot is not valid JSON: {error}"))
        })?;

        // Accept a historical raw AppState once, then the next normal AppProvider
        // save transparently converts it to the native wrapper.
        if parsed.get("schemaVersion").is_some() {
            return String::from_utf8(raw.to_vec())
                .map_err(|_| StorageCommandError::invalid("Snapshot is not UTF-8"));
        }

        let mut snapshot: NativeSnapshot = serde_json::from_value(parsed).map_err(|error| {
            StorageCommandError::invalid(format!("Native snapshot shape is invalid: {error}"))
        })?;
        if snapshot.format != NATIVE_FORMAT {
            return Err(StorageCommandError::unsupported(
                "Native snapshot format is not supported",
            ));
        }
        if snapshot.format_version != NATIVE_FORMAT_VERSION {
            return Err(StorageCommandError::unsupported(format!(
                "Native snapshot format version {} is not supported",
                snapshot.format_version,
            )));
        }
        if snapshot.attachment_refs.len() > MAX_ATTACHMENT_REFS {
            return Err(StorageCommandError::too_large(
                "Too many attachment references",
            ));
        }

        let mut refs = HashMap::new();
        for attachment_ref in snapshot.attachment_refs {
            if !is_content_hash(&attachment_ref.content_hash) {
                return Err(StorageCommandError::invalid(
                    "Attachment content hash is invalid",
                ));
            }
            let key = (attachment_ref.task_id, attachment_ref.attachment_id);
            if refs.insert(key, attachment_ref.content_hash).is_some() {
                return Err(StorageCommandError::invalid(
                    "Duplicate native attachment reference",
                ));
            }
        }

        let tasks = snapshot
            .state
            .get_mut("tasks")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| StorageCommandError::invalid("Native state.tasks must be an array"))?;
        let mut encoded_cache: HashMap<String, String> = HashMap::new();
        let mut total_attachment_bytes = 0usize;

        for task in tasks {
            let task = task
                .as_object_mut()
                .ok_or_else(|| StorageCommandError::invalid("Native task must be an object"))?;
            let task_id = required_identifier(task.get("id"), "Task.id")?;
            let attachments = task
                .get_mut("attachments")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    StorageCommandError::invalid("Native task attachments must be an array")
                })?;

            for attachment in attachments {
                let attachment = attachment.as_object_mut().ok_or_else(|| {
                    StorageCommandError::invalid("Native attachment must be an object")
                })?;
                if attachment.contains_key("dataUrl") {
                    return Err(StorageCommandError::invalid(
                        "Native snapshot contains inline attachment data",
                    ));
                }
                let attachment_id = required_identifier(attachment.get("id"), "Attachment.id")?;
                let Some(content_hash) = refs.remove(&(task_id.clone(), attachment_id)) else {
                    // Metadata-only attachments are a supported historical state.
                    continue;
                };
                let mime_type =
                    attachment
                        .get("type")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StorageCommandError::invalid("Attachment.type must be a string")
                        })?;
                if !is_valid_mime_type(mime_type.trim()) {
                    return Err(StorageCommandError::invalid(
                        "Attachment MIME type is invalid",
                    ));
                }
                let encoded = if let Some(existing) = encoded_cache.get(&content_hash) {
                    existing.clone()
                } else {
                    let bytes = self.read_verified_blob(&content_hash)?;
                    let encoded = BASE64_STANDARD.encode(&bytes);
                    encoded_cache.insert(content_hash.clone(), encoded.clone());
                    encoded
                };
                let decoded_length = base64_decoded_len(&encoded)?;
                total_attachment_bytes = total_attachment_bytes
                    .checked_add(decoded_length)
                    .ok_or_else(|| StorageCommandError::too_large("Attachment size overflow"))?;
                if total_attachment_bytes > MAX_TOTAL_ATTACHMENT_BYTES {
                    return Err(StorageCommandError::too_large(
                        "Hydrated attachments exceed the native storage limit",
                    ));
                }
                attachment.insert(
                    "dataUrl".into(),
                    Value::String(format!("data:{};base64,{}", mime_type.trim(), encoded)),
                );
            }
        }
        if !refs.is_empty() {
            return Err(StorageCommandError::invalid(
                "Native snapshot has dangling attachment references",
            ));
        }

        let hydrated = serde_json::to_string(&snapshot.state).map_err(|error| {
            StorageCommandError::invalid(format!("Cannot serialize hydrated state: {error}"))
        })?;
        if hydrated.len() > MAX_STATE_JSON_BYTES {
            return Err(StorageCommandError::too_large(
                "Hydrated state exceeds the native storage limit",
            ));
        }
        Ok(hydrated)
    }

    fn persist_blobs(&self, blobs: &HashMap<String, Vec<u8>>) -> StorageResult<()> {
        if blobs.is_empty() {
            return Ok(());
        }
        let attachment_dir = self.root.join(ATTACHMENTS_DIR);
        fs::create_dir_all(&attachment_dir).map_err(|error| {
            StorageCommandError::io("Cannot create attachment directory", error)
        })?;
        for (content_hash, bytes) in blobs {
            if !is_content_hash(content_hash) || bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(StorageCommandError::invalid("Attachment blob is invalid"));
            }
            let target = attachment_dir.join(content_hash);
            if target.exists() {
                let metadata = fs::metadata(&target).map_err(|error| {
                    StorageCommandError::io("Cannot inspect existing attachment blob", error)
                })?;
                if metadata.len() <= MAX_ATTACHMENT_BYTES as u64 {
                    let existing = fs::read(&target).map_err(|error| {
                        StorageCommandError::io("Cannot read existing attachment blob", error)
                    })?;
                    if sha256_hex(&existing) == *content_hash {
                        continue;
                    }
                }
            }
            write_atomic(&target, bytes)?;
        }
        Ok(())
    }

    fn read_verified_blob(&self, content_hash: &str) -> StorageResult<Vec<u8>> {
        if !is_content_hash(content_hash) {
            return Err(StorageCommandError::invalid(
                "Attachment content hash is invalid",
            ));
        }
        let path = self.root.join(ATTACHMENTS_DIR).join(content_hash);
        let bytes = match fs::metadata(&path) {
            Ok(metadata) => {
                if metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
                    return Err(StorageCommandError::too_large(
                        "Attachment blob exceeds the 1 MB limit",
                    ));
                }
                fs::read(&path).map_err(|error| {
                    if error.kind() == io::ErrorKind::NotFound {
                        StorageCommandError::invalid("Attachment blob is missing")
                    } else {
                        StorageCommandError::io("Cannot read attachment blob", error)
                    }
                })?
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(StorageCommandError::invalid("Attachment blob is missing"));
            }
            Err(error) => {
                return Err(StorageCommandError::io(
                    "Cannot inspect attachment blob",
                    error,
                ));
            }
        };
        if sha256_hex(&bytes) != content_hash {
            return Err(StorageCommandError::invalid(
                "Attachment blob hash mismatch",
            ));
        }
        Ok(bytes)
    }

    fn collect_unreferenced_blobs(&self) -> StorageResult<()> {
        let attachment_dir = self.root.join(ATTACHMENTS_DIR);
        if !attachment_dir.exists() {
            return Ok(());
        }
        // A quarantine is manual recovery material. Until the user explicitly
        // clears it, keep all blobs rather than guessing which ones it referenced.
        let quarantine_dir = self.root.join(QUARANTINE_DIR);
        if quarantine_dir.exists()
            && fs::read_dir(&quarantine_dir)
                .map_err(|error| StorageCommandError::io("Cannot inspect quarantine", error))?
                .next()
                .is_some()
        {
            return Ok(());
        }

        let mut referenced = HashSet::new();
        for slot in [
            StorageSlot::Primary,
            StorageSlot::Backup,
            StorageSlot::ImportBackup,
        ] {
            let Some(raw) = read_optional_limited(&self.slot_path(slot), MAX_NATIVE_JSON_BYTES)?
            else {
                continue;
            };
            let value: Value = serde_json::from_slice(&raw).map_err(|error| {
                StorageCommandError::invalid(format!("Cannot inspect stored snapshot: {error}"))
            })?;
            if value.get("format").is_none() {
                continue;
            }
            let snapshot: NativeSnapshot = serde_json::from_value(value).map_err(|error| {
                StorageCommandError::invalid(format!("Cannot inspect native snapshot: {error}"))
            })?;
            if snapshot.format != NATIVE_FORMAT || snapshot.format_version != NATIVE_FORMAT_VERSION
            {
                return Ok(());
            }
            for attachment_ref in snapshot.attachment_refs {
                if is_content_hash(&attachment_ref.content_hash) {
                    referenced.insert(attachment_ref.content_hash);
                }
            }
        }

        for entry in fs::read_dir(&attachment_dir)
            .map_err(|error| StorageCommandError::io("Cannot list attachment directory", error))?
        {
            let entry = entry
                .map_err(|error| StorageCommandError::io("Cannot inspect attachment", error))?;
            if !entry
                .file_type()
                .map_err(|error| StorageCommandError::io("Cannot inspect attachment type", error))?
                .is_file()
            {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_content_hash(&name) && !referenced.contains(&name) {
                fs::remove_file(entry.path()).map_err(|error| {
                    StorageCommandError::io("Cannot remove orphan attachment", error)
                })?;
            }
        }
        Ok(())
    }

    fn cleanup_temporary_files(&self) -> StorageResult<()> {
        cleanup_temporary_files_in(&self.root, false)?;
        cleanup_temporary_files_in(&self.root.join(ATTACHMENTS_DIR), true)
    }
}

#[tauri::command]
pub async fn focus_flow_storage_read(
    app: AppHandle,
    slot: StorageSlot,
) -> StorageResult<Option<String>> {
    run_storage(app, move |service| service.read(slot)).await
}

#[tauri::command]
pub async fn focus_flow_storage_commit(
    app: AppHandle,
    mode: StorageCommitMode,
    state_json: String,
) -> StorageResult<()> {
    run_storage(app, move |service| service.commit(mode, &state_json)).await
}

#[tauri::command]
pub async fn focus_flow_storage_recover_primary(app: AppHandle) -> StorageResult<()> {
    run_storage(app, |service| service.recover_primary_from_backup()).await
}

#[tauri::command]
pub async fn focus_flow_storage_quarantine(
    app: AppHandle,
    slot: StorageSlot,
) -> StorageResult<bool> {
    run_storage(app, move |service| service.quarantine(slot)).await
}

#[tauri::command]
pub async fn focus_flow_storage_clear(app: AppHandle) -> StorageResult<()> {
    run_storage(app, |service| service.clear()).await
}

async fn run_storage<T, F>(app: AppHandle, operation: F) -> StorageResult<T>
where
    T: Send + 'static,
    F: FnOnce(&StorageService) -> StorageResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE_LOCK
            .lock()
            .map_err(|_| StorageCommandError::new("io", "Native storage lock is poisoned"))?;
        let root = app.path().app_data_dir().map_err(|error| {
            StorageCommandError::new("io", format!("Cannot resolve app data directory: {error}"))
        })?;
        operation(&StorageService::new(root))
    })
    .await
    .map_err(|error| {
        StorageCommandError::new("io", format!("Native storage worker failed: {error}"))
    })?
}

fn required_identifier(value: Option<&Value>, field: &str) -> StorageResult<String> {
    let value = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 64 * 1024)
        .ok_or_else(|| StorageCommandError::invalid(format!("{field} is invalid")))?;
    Ok(value.to_owned())
}

fn decode_attachment_data_url(data_url: &str, declared_mime: &str) -> StorageResult<Vec<u8>> {
    if data_url.len() > MAX_ATTACHMENT_DATA_URL_BYTES {
        return Err(StorageCommandError::too_large(
            "Attachment data URL is too large",
        ));
    }
    let body = data_url
        .strip_prefix("data:")
        .ok_or_else(|| StorageCommandError::invalid("Attachment data URL prefix is invalid"))?;
    let (mime_type, encoded) = body
        .split_once(";base64,")
        .ok_or_else(|| StorageCommandError::invalid("Attachment data URL encoding is invalid"))?;
    if !is_valid_mime_type(mime_type) || !mime_type.eq_ignore_ascii_case(declared_mime.trim()) {
        return Err(StorageCommandError::invalid(
            "Attachment MIME type does not match data URL",
        ));
    }
    let bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| StorageCommandError::invalid("Attachment base64 payload is invalid"))?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(StorageCommandError::too_large(
            "Attachment exceeds the 1 MB limit",
        ));
    }
    Ok(bytes)
}

fn is_valid_mime_type(value: &str) -> bool {
    let mut parts = value.split('/');
    let Some(left) = parts.next() else {
        return false;
    };
    let Some(right) = parts.next() else {
        return false;
    };
    if parts.next().is_some() || left.is_empty() || right.is_empty() {
        return false;
    }
    left.bytes().all(is_mime_token_byte) && right.bytes().all(is_mime_token_byte)
}

fn is_mime_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
        )
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut result = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(result, "{byte:02x}");
    }
    result
}

fn is_content_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn base64_decoded_len(encoded: &str) -> StorageResult<usize> {
    if encoded.len() > MAX_ATTACHMENT_DATA_URL_BYTES {
        return Err(StorageCommandError::too_large(
            "Encoded attachment is too large",
        ));
    }
    let padding = encoded
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    encoded
        .len()
        .checked_mul(3)
        .map(|value| value / 4)
        .and_then(|value| value.checked_sub(padding))
        .ok_or_else(|| StorageCommandError::invalid("Encoded attachment length is invalid"))
}

fn read_optional_limited(path: &Path, max_bytes: usize) -> StorageResult<Option<Vec<u8>>> {
    match fs::metadata(path) {
        Ok(metadata) => {
            if metadata.len() > max_bytes as u64 {
                return Err(StorageCommandError::too_large(format!(
                    "Storage file {} exceeds its limit",
                    path.display()
                )));
            }
            fs::read(path)
                .map(Some)
                .map_err(|error| StorageCommandError::io("Cannot read storage file", error))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(StorageCommandError::io(
            "Cannot inspect storage file",
            error,
        )),
    }
}

fn write_atomic(path: &Path, contents: &[u8]) -> StorageResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| StorageCommandError::invalid("Storage path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| StorageCommandError::io("Cannot create storage directory", error))?;
    let temp_path = temporary_path(path)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                StorageCommandError::io("Cannot create temporary storage file", error)
            })?;
        file.write_all(contents).map_err(|error| {
            StorageCommandError::io("Cannot write temporary storage file", error)
        })?;
        file.sync_all().map_err(|error| {
            StorageCommandError::io("Cannot flush temporary storage file", error)
        })?;
        drop(file);
        replace_path(&temp_path, path).map_err(|error| {
            StorageCommandError::io("Cannot atomically replace storage file", error)
        })?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn temporary_path(path: &Path) -> StorageResult<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| StorageCommandError::invalid("Storage path has no parent"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| StorageCommandError::invalid("Storage file name is invalid"))?;
    Ok(parent.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed),
    )))
}

#[cfg(not(windows))]
fn replace_path(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_path(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> StorageResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| StorageCommandError::io("Cannot flush storage directory", error))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> StorageResult<()> {
    Ok(())
}

fn restore_optional_file(path: &Path, previous: Option<&[u8]>) -> StorageResult<()> {
    match previous {
        Some(contents) => write_atomic(path, contents),
        None => remove_if_exists(path),
    }
}

fn remove_if_exists(path: &Path) -> StorageResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StorageCommandError::io("Cannot remove storage file", error)),
    }
}

fn remove_dir_all_if_exists(path: &Path) -> StorageResult<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StorageCommandError::io(
            "Cannot remove storage directory",
            error,
        )),
    }
}

fn cleanup_temporary_files_in(path: &Path, attachment_directory: bool) -> StorageResult<()> {
    if !path.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(path)
        .map_err(|error| StorageCommandError::io("Cannot inspect temporary storage files", error))?
    {
        let entry = entry.map_err(|error| {
            StorageCommandError::io("Cannot inspect temporary storage entry", error)
        })?;
        if !entry
            .file_type()
            .map_err(|error| StorageCommandError::io("Cannot inspect temporary file type", error))?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let owned = name.starts_with('.')
            && name.ends_with(".tmp")
            && (attachment_directory || name.starts_with(".focus-flow-"));
        if owned {
            fs::remove_file(entry.path()).map_err(|error| {
                StorageCommandError::io("Cannot remove stale temporary file", error)
            })?;
        }
    }
    Ok(())
}

fn slot_label(slot: StorageSlot) -> &'static str {
    match slot {
        StorageSlot::Primary => "primary",
        StorageSlot::Backup => "backup",
        StorageSlot::ImportBackup => "import-backup",
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn state_json(title: &str, data_url: Option<&str>) -> String {
        serde_json::json!({
          "schemaVersion": 10,
          "tasks": [{
            "id": "task-1",
            "title": title,
            "attachments": data_url.map(|url| vec![serde_json::json!({
              "id": "attachment-1",
              "name": "note.txt",
              "type": "text/plain",
              "size": 5,
              "dataUrl": url,
            })]).unwrap_or_default(),
          }],
        })
        .to_string()
    }

    fn title(state_json: &str) -> String {
        serde_json::from_str::<Value>(state_json).unwrap()["tasks"][0]["title"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn externalizes_and_hydrates_attachment_content() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        let data_url = "data:text/plain;base64,aGVsbG8=";

        service
            .commit(
                StorageCommitMode::Save,
                &state_json("first", Some(data_url)),
            )
            .unwrap();

        let hydrated = service.read(StorageSlot::Primary).unwrap().unwrap();
        let hydrated: Value = serde_json::from_str(&hydrated).unwrap();
        assert_eq!(hydrated["tasks"][0]["attachments"][0]["dataUrl"], data_url);

        let raw: NativeSnapshot =
            serde_json::from_slice(&fs::read(temp.path().join(PRIMARY_FILE)).unwrap()).unwrap();
        assert!(raw.state["tasks"][0]["attachments"][0]
            .get("dataUrl")
            .is_none());
        assert_eq!(raw.attachment_refs.len(), 1);
        assert!(temp
            .path()
            .join(ATTACHMENTS_DIR)
            .join(&raw.attachment_refs[0].content_hash)
            .exists());
    }

    #[test]
    fn rotates_regular_and_import_backups_without_reencoding_callers() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());

        service
            .commit(StorageCommitMode::Save, &state_json("first", None))
            .unwrap();
        service
            .commit(StorageCommitMode::Save, &state_json("second", None))
            .unwrap();
        assert_eq!(
            title(&service.read(StorageSlot::Primary).unwrap().unwrap()),
            "second"
        );
        assert_eq!(
            title(&service.read(StorageSlot::Backup).unwrap().unwrap()),
            "first"
        );
        assert!(service.read(StorageSlot::ImportBackup).unwrap().is_none());

        service
            .commit(
                StorageCommitMode::ReplaceWithBackup,
                &state_json("third", None),
            )
            .unwrap();
        assert_eq!(
            title(&service.read(StorageSlot::Primary).unwrap().unwrap()),
            "third"
        );
        assert_eq!(
            title(&service.read(StorageSlot::Backup).unwrap().unwrap()),
            "second"
        );
        assert_eq!(
            title(&service.read(StorageSlot::ImportBackup).unwrap().unwrap()),
            "second"
        );
    }

    #[test]
    fn quarantines_corruption_and_recovers_the_valid_backup_atomically() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        service
            .commit(StorageCommitMode::Save, &state_json("backup", None))
            .unwrap();
        service
            .commit(StorageCommitMode::Save, &state_json("primary", None))
            .unwrap();
        fs::write(temp.path().join(PRIMARY_FILE), b"{broken").unwrap();

        assert_eq!(
            service.read(StorageSlot::Primary).unwrap_err().code,
            "invalid-data"
        );
        assert!(service.quarantine(StorageSlot::Primary).unwrap());
        service.recover_primary_from_backup().unwrap();

        assert_eq!(
            title(&service.read(StorageSlot::Primary).unwrap().unwrap()),
            "backup"
        );
        assert!(fs::read_dir(temp.path().join(QUARANTINE_DIR))
            .unwrap()
            .next()
            .is_some());
    }

    #[test]
    fn rejects_tampered_or_missing_attachment_blobs() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        service
            .commit(
                StorageCommitMode::Save,
                &state_json("with attachment", Some("data:text/plain;base64,aGVsbG8=")),
            )
            .unwrap();
        let raw: NativeSnapshot =
            serde_json::from_slice(&fs::read(temp.path().join(PRIMARY_FILE)).unwrap()).unwrap();
        fs::write(
            temp.path()
                .join(ATTACHMENTS_DIR)
                .join(&raw.attachment_refs[0].content_hash),
            b"other",
        )
        .unwrap();

        let error = service.read(StorageSlot::Primary).unwrap_err();
        assert_eq!(error.code, "invalid-data");
        assert!(error.message.contains("hash mismatch"));

        fs::remove_file(
            temp.path()
                .join(ATTACHMENTS_DIR)
                .join(&raw.attachment_refs[0].content_hash),
        )
        .unwrap();
        let error = service.read(StorageSlot::Primary).unwrap_err();
        assert_eq!(error.code, "invalid-data");
        assert!(error.message.contains("missing"));
    }

    #[test]
    fn preserves_metadata_only_attachments_without_inventing_content() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        let state = serde_json::json!({
          "schemaVersion": 10,
          "tasks": [{
            "id": "task-1",
            "attachments": [{
              "id": "attachment-1",
              "name": "missing.bin",
              "type": "application/octet-stream",
              "size": 10,
            }],
          }],
        })
        .to_string();

        service.commit(StorageCommitMode::Save, &state).unwrap();
        let hydrated: Value =
            serde_json::from_str(&service.read(StorageSlot::Primary).unwrap().unwrap()).unwrap();
        assert!(hydrated["tasks"][0]["attachments"][0]
            .get("dataUrl")
            .is_none());
    }

    #[test]
    fn regular_backup_keeps_attachment_blobs_until_no_recovery_slot_references_them() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        service
            .commit(
                StorageCommitMode::Save,
                &state_json("with attachment", Some("data:text/plain;base64,aGVsbG8=")),
            )
            .unwrap();
        let raw: NativeSnapshot =
            serde_json::from_slice(&fs::read(temp.path().join(PRIMARY_FILE)).unwrap()).unwrap();
        let blob = temp
            .path()
            .join(ATTACHMENTS_DIR)
            .join(&raw.attachment_refs[0].content_hash);

        service
            .commit(
                StorageCommitMode::Save,
                &state_json("without attachment", None),
            )
            .unwrap();
        assert!(
            blob.exists(),
            "the regular backup still references the blob"
        );

        service
            .commit(StorageCommitMode::Save, &state_json("next revision", None))
            .unwrap();
        assert!(
            !blob.exists(),
            "unreferenced content is collected after commit"
        );
    }

    #[test]
    fn rejects_mime_mismatch_and_oversized_input_before_replacing_primary() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        service
            .commit(StorageCommitMode::Save, &state_json("safe", None))
            .unwrap();
        let mismatched = state_json("unsafe", Some("data:image/png;base64,aGVsbG8="));

        assert_eq!(
            service
                .commit(StorageCommitMode::Save, &mismatched)
                .unwrap_err()
                .code,
            "invalid-data"
        );
        assert_eq!(
            title(&service.read(StorageSlot::Primary).unwrap().unwrap()),
            "safe"
        );

        let oversized = "x".repeat(MAX_STATE_JSON_BYTES + 1);
        assert_eq!(
            service
                .commit(StorageCommitMode::Save, &oversized)
                .unwrap_err()
                .code,
            "too-large"
        );
        assert_eq!(
            title(&service.read(StorageSlot::Primary).unwrap().unwrap()),
            "safe"
        );
    }

    #[test]
    fn accepts_a_legacy_raw_app_state_for_one_migration_cycle() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        let legacy = state_json("legacy", Some("data:text/plain;base64,aGVsbG8="));
        fs::write(temp.path().join(PRIMARY_FILE), &legacy).unwrap();

        assert_eq!(service.read(StorageSlot::Primary).unwrap().unwrap(), legacy);
    }

    #[test]
    fn clear_removes_snapshots_attachments_quarantine_and_stale_temps() {
        let temp = TempDir::new().unwrap();
        let service = StorageService::new(temp.path().to_path_buf());
        service
            .commit(
                StorageCommitMode::Save,
                &state_json("first", Some("data:text/plain;base64,aGVsbG8=")),
            )
            .unwrap();
        fs::write(temp.path().join(".focus-flow-data.json.1.tmp"), b"temp").unwrap();
        fs::create_dir_all(temp.path().join(QUARANTINE_DIR)).unwrap();
        fs::write(
            temp.path().join(QUARANTINE_DIR).join("old.corrupt.json"),
            b"broken",
        )
        .unwrap();

        service.clear().unwrap();

        assert!(!temp.path().join(PRIMARY_FILE).exists());
        assert!(!temp.path().join(ATTACHMENTS_DIR).exists());
        assert!(!temp.path().join(QUARANTINE_DIR).exists());
        assert!(!temp.path().join(".focus-flow-data.json.1.tmp").exists());
    }
}
