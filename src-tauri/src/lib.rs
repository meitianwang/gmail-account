use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DATA_FILE_NAME: &str = "gmail_manager_data.json";
const DATA_VERSION: u32 = 1;
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDraft {
    login: String,
    password: String,
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
    authenticator_token: String,
    app_password: String,
    authenticator_url: String,
    messages_url: String,
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

fn parse_accounts(raw: &str) -> Result<Vec<AccountDraft>, String> {
    let tokens: Vec<String> = raw
        .split(|char| char == ';' || char == '\n' || char == '\r')
        .map(|token| token.trim_matches('\u{feff}').trim())
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    let mut index = 0usize;

    while index < tokens.len() {
        let login = &tokens[index];
        if !looks_like_login(login) {
            return Err(format!(
                "导入格式错误：第 {position} 个字段应为邮箱账号，但读取到 `{value}`。\n请确保每条记录以 login 开头，后续字段可选。\n格式：{{login}};{{password}};{{authenticatorToken}};{{appPassword}};{{authenticatorUrl}};{{messagesUrl}}（后 4 项可省略）",
                position = index + 1,
                value = login
            ));
        }
        index += 1;

        let mut trailing_fields: Vec<String> = Vec::new();
        while index < tokens.len() && !looks_like_login(&tokens[index]) {
            trailing_fields.push(tokens[index].to_string());
            index += 1;
        }

        if trailing_fields.is_empty() {
            return Err(format!(
                "导入格式错误：账号 `{login}` 缺少 password 字段。最少需要 login + password。"
            ));
        }

        let extra_note = if trailing_fields.len() > 5 {
            trailing_fields[5..].join("\n")
        } else {
            String::new()
        };

        records.push(AccountDraft {
            login: login.to_string(),
            password: trailing_fields.first().cloned().unwrap_or_default(),
            authenticator_token: trailing_fields.get(1).cloned().unwrap_or_default(),
            app_password: trailing_fields.get(2).cloned().unwrap_or_default(),
            authenticator_url: trailing_fields.get(3).cloned().unwrap_or_default(),
            messages_url: trailing_fields.get(4).cloned().unwrap_or_default(),
            note: extra_note,
        });
    }

    Ok(records)
}

fn looks_like_login(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.contains(' ')
        || value.starts_with("http://")
        || value.starts_with("https://")
    {
        return false;
    }

    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();

    if local.is_empty() || domain.is_empty() || parts.next().is_some() {
        return false;
    }

    domain.contains('.')
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
