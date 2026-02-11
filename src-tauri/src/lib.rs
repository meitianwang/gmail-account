use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    sync::LazyLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DATA_FILE_NAME: &str = "gmail_manager_data.json";
const DATA_VERSION: u32 = 1;
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

static EMAIL_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$").unwrap());
static PHONE_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\+?[0-9\-\s\(\)]{8,}$").unwrap());
static URL_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)https?://[^\s]+").unwrap());
static TOKEN_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z2-7]{16,32}$").unwrap()); // Base32 token

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDraft {
    login: String,
    password: String,
    recovery_email: String,
    phone: String,
    authenticator_token: String,
    app_password: String,
    authenticator_url: String,
    messages_url: String,
    note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountRecord {
    id: String,
    login: String,
    password: String,
    #[serde(default)]
    recovery_email: String,
    #[serde(default)]
    phone: String,
    #[serde(default)]
    authenticator_token: String,
    #[serde(default)]
    app_password: String,
    #[serde(default)]
    authenticator_url: String,
    #[serde(default)]
    messages_url: String,
    #[serde(default)]
    note: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FamilyMember {
    account_id: String,
    role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FamilyGroup {
    id: String,
    name: String,
    note: String,
    members: Vec<FamilyMember>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppData {
    version: u32,
    accounts: Vec<AccountRecord>,
    groups: Vec<FamilyGroup>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    imported: usize,
    created: usize,
    updated: usize,
    data: AppData,
}

fn empty_data() -> AppData {
    AppData {
        version: DATA_VERSION,
        accounts: Vec::new(),
        groups: Vec::new(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn generate_id(prefix: &str) -> String {
    format!(
        "{}-{}-{}",
        prefix,
        now_ms(),
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;

    dir.push(DATA_FILE_NAME);
    Ok(dir)
}

fn read_data_from_disk(app: &AppHandle) -> Result<AppData, String> {
    let file_path = data_file_path(app)?;

    if !file_path.exists() {
        return Ok(empty_data());
    }

    let raw = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "读取数据文件失败 ({}): {error}",
            file_path.to_string_lossy()
        )
    })?;

    if raw.trim().is_empty() {
        return Ok(empty_data());
    }

    let parsed: AppData = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "解析数据文件失败 ({}): {error}",
            file_path.to_string_lossy()
        )
    })?;

    Ok(normalize_data(parsed))
}

fn write_data_to_disk(app: &AppHandle, data: &AppData) -> Result<(), String> {
    let file_path = data_file_path(app)?;
    let serialized =
        serde_json::to_string_pretty(data).map_err(|error| format!("序列化数据失败: {error}"))?;

    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "写入数据文件失败 ({}): {error}",
            file_path.to_string_lossy()
        )
    })
}

fn normalize_data(mut data: AppData) -> AppData {
    let current = now_ms();
    data.version = DATA_VERSION;

    let mut account_seen = HashSet::new();
    data.accounts
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    let mut normalized_accounts = Vec::with_capacity(data.accounts.len());

    for mut account in data.accounts {
        account.login = account.login.trim().to_string();
        account.password = account.password.trim().to_string();
        account.recovery_email = account.recovery_email.trim().to_string();
        account.phone = account.phone.trim().to_string();
        account.authenticator_token = account.authenticator_token.trim().to_string();
        account.app_password = account.app_password.trim().to_string();
        account.authenticator_url = account.authenticator_url.trim().to_string();
        account.messages_url = account.messages_url.trim().to_string();
        account.note = account.note.trim().to_string();

        if account.login.is_empty() {
            continue;
        }

        if account.id.trim().is_empty() {
            account.id = generate_id("acc");
        }

        if account.created_at <= 0 {
            account.created_at = current;
        }
        if account.updated_at <= 0 {
            account.updated_at = current;
        }

        let login_key = account.login.to_lowercase();
        if account_seen.insert(login_key) {
            normalized_accounts.push(account);
        }
    }

    normalized_accounts
        .sort_by(|left, right| left.login.to_lowercase().cmp(&right.login.to_lowercase()));
    data.accounts = normalized_accounts;

    let account_ids: HashSet<String> = data
        .accounts
        .iter()
        .map(|account| account.id.clone())
        .collect();

    let mut normalized_groups = Vec::with_capacity(data.groups.len());
    let mut globally_assigned_accounts: HashSet<String> = HashSet::new();
    for mut group in data.groups {
        if group.id.trim().is_empty() {
            group.id = generate_id("grp");
        }

        group.name = group.name.trim().to_string();
        group.note = group.note.trim().to_string();

        if group.name.is_empty() {
            group.name = "未命名家庭组".to_string();
        }

        if group.created_at <= 0 {
            group.created_at = current;
        }
        if group.updated_at <= 0 {
            group.updated_at = current;
        }

        let mut member_seen = HashSet::new();
        let mut normalized_members = Vec::with_capacity(group.members.len());

        for mut member in group.members {
            member.account_id = member.account_id.trim().to_string();
            member.role = normalize_member_role(&member.role);

            if member.account_id.is_empty() || !account_ids.contains(&member.account_id) {
                continue;
            }

            if member_seen.insert(member.account_id.clone()) {
                normalized_members.push(member);
            }
        }

        normalized_members.sort_by_key(|member| member_role_priority(&member.role));

        let mut has_admin = false;
        let mut constrained_members = Vec::with_capacity(normalized_members.len());

        for member in normalized_members {
            if globally_assigned_accounts.contains(&member.account_id) {
                continue;
            }

            match member.role.as_str() {
                "admin" => {
                    if has_admin {
                        continue;
                    }
                    has_admin = true;
                }
                _ => {}
            }

            globally_assigned_accounts.insert(member.account_id.clone());
            constrained_members.push(member);
        }

        group.members = constrained_members;
        normalized_groups.push(group);
    }

    normalized_groups
        .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    data.groups = normalized_groups;

    data
}

fn normalize_member_role(raw_role: &str) -> String {
    match raw_role.trim().to_lowercase().as_str() {
        "admin" | "manager" | "owner" => "admin".to_string(),
        "member" | "adult" | "child" | "parent" | "invited" | "invite" | "pending" => {
            "member".to_string()
        }
        _ => "member".to_string(),
    }
}

fn member_role_priority(role: &str) -> usize {
    match role {
        "admin" => 0,
        _ => 1,
    }
}

fn looks_like_email(value: &str) -> bool {
    EMAIL_REGEX.is_match(value.trim())
}

fn empty_draft() -> AccountDraft {
    AccountDraft {
        login: String::new(),
        password: String::new(),
        recovery_email: String::new(),
        phone: String::new(),
        authenticator_token: String::new(),
        app_password: String::new(),
        authenticator_url: String::new(),
        messages_url: String::new(),
        note: String::new(),
    }
}

fn finalize_draft(mut draft: AccountDraft, buffer: Vec<String>) -> AccountDraft {
    for line in buffer {
        if draft.app_password.is_empty() && line.len() == 16 && !TOKEN_REGEX.is_match(&line) {
            draft.app_password = line;
        } else {
            let prefix = if draft.note.is_empty() { "" } else { "\n" };
            draft.note = format!("{}{}{}", draft.note, prefix, line);
        }
    }

    if draft.authenticator_url.is_empty() && !draft.authenticator_token.is_empty() {
        draft.authenticator_url = "https://2fa.fun".to_string();
    }

    draft
}

fn parse_accounts(raw: &str) -> Result<Vec<AccountDraft>, String> {
    let mut drafts = Vec::new();
    let lines: Vec<&str> = raw
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();

    let mut current_draft: Option<AccountDraft> = None;
    let mut field_buffer: Vec<String> = Vec::new();

    for line in lines {
        if line.contains("----") {
            if let Some(draft) = current_draft.take() {
                drafts.push(finalize_draft(draft, field_buffer));
                field_buffer = Vec::new();
            }

            let parts: Vec<&str> = line.split("----").map(|s| s.trim()).collect();
            if parts.is_empty() || !looks_like_email(parts[0]) {
                continue;
            }

            let mut draft = empty_draft();
            draft.login = parts[0].to_string();
            if parts.len() > 1 {
                draft.password = parts[1].to_string();
            }
            if parts.len() > 2 {
                if looks_like_email(parts[2]) {
                    draft.recovery_email = parts[2].to_string();
                } else if TOKEN_REGEX.is_match(parts[2]) {
                    draft.authenticator_token = parts[2].to_string();
                }
            }
            if parts.len() > 3 && TOKEN_REGEX.is_match(parts[3]) {
                draft.authenticator_token = parts[3].to_string();
            }
            drafts.push(finalize_draft(draft, Vec::new()));
            continue;
        }

        let clean_line = line.trim_matches(|c| c == ';' || c == ',').trim();

        if looks_like_email(clean_line) {
            if let Some(ref mut draft) = current_draft {
                if !draft.password.is_empty() && draft.recovery_email.is_empty() {
                    draft.recovery_email = clean_line.to_string();
                    continue;
                }
            }

            if let Some(draft) = current_draft.take() {
                drafts.push(finalize_draft(draft, field_buffer));
                field_buffer = Vec::new();
            }

            let mut draft = empty_draft();
            draft.login = clean_line.to_string();
            current_draft = Some(draft);
        } else if let Some(ref mut draft) = current_draft {
            if draft.password.is_empty() {
                draft.password = clean_line.to_string();
            } else if clean_line.starts_with("辅助邮箱") || clean_line.starts_with("recovery") {
                let parts: Vec<&str> = clean_line.splitn(2, ':').collect();
                if parts.len() > 1 {
                    draft.recovery_email = parts[1].trim().to_string();
                }
            } else if clean_line.starts_with("手机号") || clean_line.starts_with("phone") {
                let parts: Vec<&str> = clean_line.splitn(2, ':').collect();
                if parts.len() > 1 {
                    draft.phone = parts[1].trim().to_string();
                }
            } else if clean_line.starts_with("接码链接:") || clean_line.starts_with("sms:") {
                 let val = clean_line.splitn(2, ':').nth(1).unwrap_or("").trim();
                 let prefix = if draft.note.is_empty() { "" } else { "\n" };
                 draft.note = format!("{}{}{}", draft.note, prefix, val);
            } else if clean_line.starts_with("2FA验证码查看网站:") || clean_line.starts_with("2fa:") {
                 let val = clean_line.splitn(2, ':').nth(1).unwrap_or("").trim();
                 if let Some(mat) = URL_REGEX.find(val) {
                     draft.authenticator_url = mat.as_str().to_string();
                 } else {
                     // If no url found, maybe the value itself is useful?
                     draft.authenticator_url = val.to_string();
                 }
            } else if clean_line.starts_with("http") {
                if clean_line.contains("2fa") || clean_line.contains("totp") {
                    draft.authenticator_url = clean_line.to_string();
                } else if clean_line.contains("sms") || clean_line.contains("接码") {
                    let prefix = if draft.note.is_empty() { "" } else { "\n" };
                    draft.note = format!("{}{}{}", draft.note, prefix, clean_line);
                } else {
                    draft.messages_url = clean_line.to_string();
                }
            } else if TOKEN_REGEX.is_match(clean_line) {
                draft.authenticator_token = clean_line.to_string();
            } else if PHONE_REGEX.is_match(clean_line) {
                draft.phone = clean_line.to_string();
            } else {
                field_buffer.push(clean_line.to_string());
            }
        }
    }

    if let Some(draft) = current_draft {
        drafts.push(finalize_draft(draft, field_buffer));
    }

    Ok(drafts)
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<AppData, String> {
    read_data_from_disk(&app)
}

#[tauri::command]
fn save_data(app: AppHandle, data: AppData) -> Result<AppData, String> {
    let normalized = normalize_data(data);
    write_data_to_disk(&app, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
fn import_accounts(app: AppHandle, raw: String) -> Result<ImportResult, String> {
    let imports = parse_accounts(&raw)?;

    if imports.is_empty() {
        let data = read_data_from_disk(&app)?;
        return Ok(ImportResult {
            imported: 0,
            created: 0,
            updated: 0,
            data,
        });
    }

    let now = now_ms();
    let mut data = read_data_from_disk(&app)?;
    let mut created = 0usize;
    let mut updated = 0usize;

    for imported in imports {
        let login_key = imported.login.to_lowercase();
        if let Some(existing) = data
            .accounts
            .iter_mut()
            .find(|account| account.login.to_lowercase() == login_key)
        {
            existing.login = imported.login.trim().to_string();

            let password = imported.password.trim();
            if !password.is_empty() {
                existing.password = password.to_string();
            }

            let recovery_email = imported.recovery_email.trim();
            if !recovery_email.is_empty() {
                existing.recovery_email = recovery_email.to_string();
            }

            let phone = imported.phone.trim();
            if !phone.is_empty() {
                existing.phone = phone.to_string();
            }

            let authenticator_token = imported.authenticator_token.trim();
            if !authenticator_token.is_empty() {
                existing.authenticator_token = authenticator_token.to_string();
            }

            let app_password = imported.app_password.trim();
            if !app_password.is_empty() {
                existing.app_password = app_password.to_string();
            }

            let authenticator_url = imported.authenticator_url.trim();
            if !authenticator_url.is_empty() {
                existing.authenticator_url = authenticator_url.to_string();
            }

            let messages_url = imported.messages_url.trim();
            if !messages_url.is_empty() {
                existing.messages_url = messages_url.to_string();
            }

            let imported_note = imported.note.trim();
            if !imported_note.is_empty() {
                if existing.note.trim().is_empty() {
                    existing.note = imported_note.to_string();
                } else if !existing.note.contains(imported_note) {
                    existing.note = format!("{}\n{}", existing.note.trim(), imported_note);
                }
            }

            existing.updated_at = now;
            updated += 1;
        } else {
            data.accounts.push(AccountRecord {
                id: generate_id("acc"),
                login: imported.login.trim().to_string(),
                password: imported.password.trim().to_string(),
                recovery_email: imported.recovery_email.trim().to_string(),
                phone: imported.phone.trim().to_string(),
                authenticator_token: imported.authenticator_token.trim().to_string(),
                app_password: imported.app_password.trim().to_string(),
                authenticator_url: imported.authenticator_url.trim().to_string(),
                messages_url: imported.messages_url.trim().to_string(),
                note: imported.note.trim().to_string(),
                created_at: now,
                updated_at: now,
            });
            created += 1;
        }
    }

    data = normalize_data(data);
    write_data_to_disk(&app, &data)?;

    Ok(ImportResult {
        imported: created + updated,
        created,
        updated,
        data,
    })
}

#[tauri::command]
fn get_storage_path(app: AppHandle) -> Result<String, String> {
    Ok(data_file_path(&app)?.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            import_accounts,
            get_storage_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
