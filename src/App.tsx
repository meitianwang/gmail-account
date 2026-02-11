import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type MemberRole = "admin" | "member";
type ViewMode = "accounts" | "families";

interface AccountRecord {
  id: string;
  login: string;
  password: string;
  authenticatorToken: string;
  appPassword: string;
  authenticatorUrl: string;
  messagesUrl: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

interface FamilyMember {
  accountId: string;
  role: MemberRole | string;
}

interface FamilyGroup {
  id: string;
  name: string;
  note: string;
  members: FamilyMember[];
  createdAt: number;
  updatedAt: number;
}

interface AppData {
  version: number;
  accounts: AccountRecord[];
  groups: FamilyGroup[];
}

interface ImportResult {
  imported: number;
  created: number;
  updated: number;
  data: AppData;
}

interface Notice {
  type: "success" | "error" | "info";
  text: string;
}

interface AccountFormState {
  login: string;
  password: string;
  authenticatorToken: string;
  appPassword: string;
  authenticatorUrl: string;
  messagesUrl: string;
  note: string;
}

const EMPTY_DATA: AppData = {
  version: 1,
  accounts: [],
  groups: [],
};

const EMPTY_FORM: AccountFormState = {
  login: "",
  password: "",
  authenticatorToken: "",
  appPassword: "",
  authenticatorUrl: "",
  messagesUrl: "",
  note: "",
};

function maskValue(value: string, showSecrets: boolean) {
  if (showSecrets || !value) {
    return value || "-";
  }

  if (value.length <= 6) {
    return "*".repeat(value.length);
  }

  const stars = "*".repeat(Math.max(value.length - 4, 4));
  return `${value.slice(0, 2)}${stars}${value.slice(-2)}`;
}

function randomId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  return `${prefix}-${uuid}`;
}

function roleLabel(role: string) {
  return role === "admin" ? "管理员" : "成员";
}

function rolePriority(role: string) {
  return role === "admin" ? 0 : 1;
}

function sortMembers(members: FamilyMember[]) {
  return [...members].sort((left, right) => {
    const roleDiff = rolePriority(left.role) - rolePriority(right.role);
    if (roleDiff !== 0) {
      return roleDiff;
    }

    return left.accountId.localeCompare(right.accountId);
  });
}

function App() {
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [storagePath, setStoragePath] = useState("");

  const [activeView, setActiveView] = useState<ViewMode>("accounts");

  const [query, setQuery] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);

  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormState>(EMPTY_FORM);

  const [groupName, setGroupName] = useState("");
  const [groupNote, setGroupNote] = useState("");
  const [groupAdminId, setGroupAdminId] = useState("");
  const [memberDrafts, setMemberDrafts] = useState<Record<string, { accountId: string }>>({});

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [loaded, path] = await Promise.all([
          invoke<AppData>("load_data"),
          invoke<string>("get_storage_path"),
        ]);
        setData(loaded);
        setStoragePath(path);
      } catch (error) {
        setNotice({ type: "error", text: `初始化失败: ${String(error)}` });
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  const accountToGroupMap = useMemo(() => {
    const mapping = new Map<string, string[]>();

    for (const group of data.groups) {
      for (const member of group.members) {
        const values = mapping.get(member.accountId) || [];
        values.push(`${group.name} (${roleLabel(member.role)})`);
        mapping.set(member.accountId, values);
      }
    }

    return mapping;
  }, [data.groups]);

  const accountMap = useMemo(() => {
    return new Map(data.accounts.map((account) => [account.id, account]));
  }, [data.accounts]);

  const filteredAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return data.accounts;
    }

    return data.accounts.filter((account) => {
      const relatedGroups = accountToGroupMap.get(account.id)?.join(" ") || "";
      return [
        account.login,
        account.password,
        account.authenticatorToken,
        account.appPassword,
        account.authenticatorUrl,
        account.messagesUrl,
        account.note,
        relatedGroups,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [accountToGroupMap, data.accounts, query]);

  const linkedAccountCount = useMemo(() => {
    const ids = new Set<string>();
    for (const group of data.groups) {
      for (const member of group.members) {
        ids.add(member.accountId);
      }
    }

    return ids.size;
  }, [data.groups]);

  const showNotice = (type: Notice["type"], text: string) => {
    setNotice({ type, text });
  };

  const persistData = async (nextData: AppData, successMessage?: string) => {
    setSaving(true);
    try {
      const saved = await invoke<AppData>("save_data", { data: nextData });
      setData(saved);
      if (successMessage) {
        showNotice("success", successMessage);
      }
      return true;
    } catch (error) {
      showNotice("error", `保存失败: ${String(error)}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const removeAccountFromAllGroups = (groups: FamilyGroup[], accountId: string, now: number) => {
    return groups.map((group) => {
      const nextMembers = group.members.filter((member) => member.accountId !== accountId);
      if (nextMembers.length === group.members.length) {
        return group;
      }

      return {
        ...group,
        members: sortMembers(nextMembers),
        updatedAt: now,
      };
    });
  };

  const getGroupAdmin = (group: FamilyGroup) => {
    return group.members.find((member) => member.role === "admin");
  };

  const resetEditor = () => {
    setEditingAccountId(null);
    setForm(EMPTY_FORM);
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showNotice("info", `${label} 已复制到剪贴板`);
    } catch {
      showNotice("error", `复制 ${label} 失败`);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      showNotice("error", "请先粘贴账号文本");
      return;
    }

    setImporting(true);
    try {
      const result = await invoke<ImportResult>("import_accounts", { raw: importText });
      setData(result.data);
      setImportText("");
      showNotice(
        "success",
        `导入完成：总计 ${result.imported} 条，新增 ${result.created} 条，更新 ${result.updated} 条`,
      );
    } catch (error) {
      showNotice("error", `导入失败: ${String(error)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleSaveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.login.trim()) {
      showNotice("error", "Gmail 登录账号不能为空");
      return;
    }

    if (!form.password.trim()) {
      showNotice("error", "密码不能为空");
      return;
    }

    const now = Date.now();

    if (editingAccountId) {
      const nextAccounts = data.accounts.map((account) => {
        if (account.id !== editingAccountId) {
          return account;
        }

        return {
          ...account,
          login: form.login.trim(),
          password: form.password.trim(),
          authenticatorToken: form.authenticatorToken.trim(),
          appPassword: form.appPassword.trim(),
          authenticatorUrl: form.authenticatorUrl.trim(),
          messagesUrl: form.messagesUrl.trim(),
          note: form.note.trim(),
          updatedAt: now,
        };
      });

      const ok = await persistData({ ...data, accounts: nextAccounts }, "账号已更新");
      if (ok) {
        resetEditor();
      }
      return;
    }

    const newAccount: AccountRecord = {
      id: randomId("acc"),
      login: form.login.trim(),
      password: form.password.trim(),
      authenticatorToken: form.authenticatorToken.trim(),
      appPassword: form.appPassword.trim(),
      authenticatorUrl: form.authenticatorUrl.trim(),
      messagesUrl: form.messagesUrl.trim(),
      note: form.note.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const ok = await persistData(
      { ...data, accounts: [...data.accounts, newAccount] },
      "账号已新增",
    );

    if (ok) {
      resetEditor();
    }
  };

  const beginEditAccount = (account: AccountRecord) => {
    setEditingAccountId(account.id);
    setForm({
      login: account.login,
      password: account.password,
      authenticatorToken: account.authenticatorToken,
      appPassword: account.appPassword,
      authenticatorUrl: account.authenticatorUrl,
      messagesUrl: account.messagesUrl,
      note: account.note || "",
    });
  };

  const handleDeleteAccount = async (accountId: string) => {
    const account = accountMap.get(accountId);
    if (!account) {
      return;
    }

    const confirmed = window.confirm(`确认删除账号 ${account.login} 吗？`);
    if (!confirmed) {
      return;
    }

    const nextGroups = data.groups.map((group) => ({
      ...group,
      members: sortMembers(group.members.filter((member) => member.accountId !== accountId)),
      updatedAt: Date.now(),
    }));

    const nextData: AppData = {
      ...data,
      accounts: data.accounts.filter((item) => item.id !== accountId),
      groups: nextGroups,
    };

    const ok = await persistData(nextData, "账号已删除");
    if (ok && editingAccountId === accountId) {
      resetEditor();
    }
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!groupName.trim()) {
      showNotice("error", "家庭组名称不能为空");
      return;
    }

    if (!groupAdminId) {
      showNotice("error", "创建家庭组时必须选择管理员");
      return;
    }

    if (!accountMap.has(groupAdminId)) {
      showNotice("error", "管理员账号不存在，请重新选择");
      return;
    }

    const now = Date.now();
    const sanitizedGroups = removeAccountFromAllGroups(data.groups, groupAdminId, now);
    const newGroup: FamilyGroup = {
      id: randomId("grp"),
      name: groupName.trim(),
      note: groupNote.trim(),
      members: [{ accountId: groupAdminId, role: "admin" }],
      createdAt: now,
      updatedAt: now,
    };

    const ok = await persistData(
      { ...data, groups: [...sanitizedGroups, newGroup] },
      "家庭组已创建",
    );

    if (ok) {
      setGroupName("");
      setGroupNote("");
      setGroupAdminId("");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    const group = data.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    const confirmed = window.confirm(`确认删除家庭组 ${group.name} 吗？`);
    if (!confirmed) {
      return;
    }

    await persistData(
      { ...data, groups: data.groups.filter((item) => item.id !== groupId) },
      "家庭组已删除",
    );
  };

  const handleAssignAdmin = async (groupId: string, adminAccountId: string) => {
    if (!adminAccountId) {
      showNotice("error", "管理员不能为空");
      return;
    }

    if (!accountMap.has(adminAccountId)) {
      showNotice("error", "所选管理员账号不存在");
      return;
    }

    const now = Date.now();
    const removedEverywhere = removeAccountFromAllGroups(data.groups, adminAccountId, now);

    const nextGroups = removedEverywhere.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      return {
        ...group,
        members: sortMembers([...group.members, { accountId: adminAccountId, role: "admin" }]),
        updatedAt: now,
      };
    });

    await persistData({ ...data, groups: nextGroups }, "管理员已更新");
  };

  const updateMemberDraft = (groupId: string, accountId: string) => {
    setMemberDrafts((previous) => ({
      ...previous,
      [groupId]: { accountId },
    }));
  };

  const handleAddMember = async (groupId: string) => {
    const group = data.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    const admin = getGroupAdmin(group);
    if (!admin) {
      showNotice("error", "该家庭组没有管理员，请先设置管理员");
      return;
    }

    const draft = memberDrafts[groupId] || { accountId: "" };
    if (!draft.accountId) {
      showNotice("error", "请先选择账号");
      return;
    }

    if (!accountMap.has(draft.accountId)) {
      showNotice("error", "所选账号不存在，请重新选择");
      return;
    }

    if (draft.accountId === admin.accountId) {
      showNotice("error", "管理员不能作为普通成员添加");
      return;
    }

    const now = Date.now();
    const removedEverywhere = removeAccountFromAllGroups(data.groups, draft.accountId, now);

    const nextGroups = removedEverywhere.map((item) => {
      if (item.id !== groupId) {
        return item;
      }

      return {
        ...item,
        members: sortMembers([...item.members, { accountId: draft.accountId, role: "member" }]),
        updatedAt: now,
      };
    });

    const ok = await persistData({ ...data, groups: nextGroups }, "成员已添加");
    if (ok) {
      updateMemberDraft(groupId, "");
    }
  };

  const handleRemoveMember = async (groupId: string, accountId: string) => {
    const group = data.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    const target = group.members.find((member) => member.accountId === accountId);
    if (!target) {
      return;
    }

    if (target.role === "admin") {
      showNotice("error", "管理员不能直接移除，请先更换管理员");
      return;
    }

    const nextGroups = data.groups.map((item) => {
      if (item.id !== groupId) {
        return item;
      }

      return {
        ...item,
        members: sortMembers(item.members.filter((member) => member.accountId !== accountId)),
        updatedAt: Date.now(),
      };
    });

    await persistData({ ...data, groups: nextGroups }, "成员已移除");
  };

  const pageTitle = activeView === "accounts" ? "账号管理" : "家庭组管理";
  const pageDescription = activeView === "accounts"
    ? "导入、编辑和搜索账号资料。"
    : "独立管理家庭组结构，不和账号编辑混在同一屏。";

  if (loading) {
    return (
      <main className="app-root">
        <section className="loading-state">正在加载本地数据...</section>
      </main>
    );
  }

  return (
    <main className="app-root">
      <aside className="sidebar">
        <div className="brand">
          <h1>Gmail Control</h1>
          <p>Account Workspace</p>
        </div>

        <nav className="side-nav" aria-label="页面导航">
          <button
            type="button"
            className={`nav-btn ${activeView === "accounts" ? "active" : ""}`}
            onClick={() => setActiveView("accounts")}
          >
            账号管理
          </button>
          <button
            type="button"
            className={`nav-btn ${activeView === "families" ? "active" : ""}`}
            onClick={() => setActiveView("families")}
          >
            家庭组管理
          </button>
        </nav>

        <section className="sidebar-metrics">
          <article className="metric-box">
            <span>账号总数</span>
            <strong>{data.accounts.length}</strong>
          </article>
          <article className="metric-box">
            <span>已入组账号</span>
            <strong>{linkedAccountCount}</strong>
          </article>
          <article className="metric-box">
            <span>家庭组数量</span>
            <strong>{data.groups.length}</strong>
          </article>
        </section>

        <p className="storage-path">数据文件：{storagePath || "(未加载)"}</p>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h2>{pageTitle}</h2>
            <p>{pageDescription}</p>
          </div>
          <div className="workspace-tools">
            {activeView === "accounts" ? (
              <button type="button" className="ghost-btn" onClick={() => setActiveView("families")}>去家庭组页</button>
            ) : (
              <button type="button" className="ghost-btn" onClick={() => setActiveView("accounts")}>去账号页</button>
            )}
            <span className={`status-pill ${saving ? "saving" : "ready"}`}>
              {saving ? "保存中" : "已保存"}
            </span>
          </div>
        </header>

        {notice ? <section className={`notice ${notice.type}`}>{notice.text}</section> : null}

        {activeView === "accounts" ? (
          <section className="accounts-layout">
            <article className="section-card import-card">
              <div className="section-head">
                <h3>批量导入账号</h3>
                <button type="button" className="ghost-btn" onClick={() => setImportText("")}>清空</button>
              </div>
              <p className="helper-text">每条记录以邮箱开头，至少 login/password；多余字段自动存到备注。</p>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.currentTarget.value)}
                placeholder="支持原始 6 字段格式，也支持只填 login + password。"
                rows={10}
              />
              <div className="actions-row">
                <button type="button" onClick={handleImport} disabled={importing || saving}>
                  {importing ? "导入中..." : "导入并合并"}
                </button>
              </div>
            </article>

            <article className="section-card editor-card">
              <div className="section-head">
                <h3>{editingAccountId ? "编辑账号" : "手动新增账号"}</h3>
                {editingAccountId ? (
                  <button type="button" className="ghost-btn" onClick={resetEditor}>取消编辑</button>
                ) : null}
              </div>

              <form className="editor-form" onSubmit={handleSaveAccount}>
                <label>
                  Gmail 登录账号
                  <input
                    value={form.login}
                    onChange={(event) => setForm({ ...form, login: event.currentTarget.value })}
                    placeholder="name@gmail.com"
                    required
                  />
                </label>
                <label>
                  登录密码
                  <input
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                    placeholder="账号密码"
                    required
                  />
                </label>
                <label>
                  Authenticator Token
                  <input
                    value={form.authenticatorToken}
                    onChange={(event) => setForm({ ...form, authenticatorToken: event.currentTarget.value })}
                    placeholder="TOTP Token"
                  />
                </label>
                <label>
                  App Password
                  <input
                    value={form.appPassword}
                    onChange={(event) => setForm({ ...form, appPassword: event.currentTarget.value })}
                    placeholder="应用专用密码"
                  />
                </label>
                <label>
                  Authenticator URL
                  <input
                    value={form.authenticatorUrl}
                    onChange={(event) => setForm({ ...form, authenticatorUrl: event.currentTarget.value })}
                    placeholder="https://..."
                  />
                </label>
                <label>
                  Messages URL
                  <input
                    value={form.messagesUrl}
                    onChange={(event) => setForm({ ...form, messagesUrl: event.currentTarget.value })}
                    placeholder="https://..."
                  />
                </label>
                <label>
                  备注
                  <input
                    value={form.note}
                    onChange={(event) => setForm({ ...form, note: event.currentTarget.value })}
                    placeholder="可选"
                  />
                </label>
                <button type="submit" disabled={saving}>
                  {saving ? "保存中..." : editingAccountId ? "保存修改" : "新增账号"}
                </button>
              </form>
            </article>

            <article className="section-card list-card">
              <div className="section-head">
                <h3>账号列表</h3>
                <div className="inline-actions">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="搜索账号、链接或家庭组"
                  />
                  <button type="button" className="ghost-btn" onClick={() => setShowSecrets(!showSecrets)}>
                    {showSecrets ? "隐藏敏感字段" : "显示敏感字段"}
                  </button>
                </div>
              </div>

              {filteredAccounts.length === 0 ? (
                <p className="empty-text">没有匹配的账号。</p>
              ) : (
                <div className="account-list">
                  {filteredAccounts.map((account) => {
                    const groups = accountToGroupMap.get(account.id) || [];
                    return (
                      <article key={account.id} className="account-card">
                        <div className="account-head">
                          <h4>{account.login}</h4>
                          <div className="inline-actions">
                            <button type="button" className="ghost-btn" onClick={() => beginEditAccount(account)}>编辑</button>
                            <button type="button" className="danger-btn" onClick={() => handleDeleteAccount(account.id)}>删除</button>
                          </div>
                        </div>

                        <div className="meta-row">
                          {groups.length === 0 ? <span className="tag">未绑定家庭组</span> : null}
                          {groups.map((groupName) => (
                            <span key={groupName} className="tag">{groupName}</span>
                          ))}
                        </div>

                        <dl className="field-grid">
                          <div>
                            <dt>密码</dt>
                            <dd>
                              <code>{maskValue(account.password, showSecrets)}</code>
                              <button type="button" className="ghost-btn" onClick={() => copyValue(account.password, "密码")}>复制</button>
                            </dd>
                          </div>
                          <div>
                            <dt>Authenticator Token</dt>
                            <dd>
                              <code>{maskValue(account.authenticatorToken, showSecrets)}</code>
                              <button type="button" className="ghost-btn" onClick={() => copyValue(account.authenticatorToken, "Authenticator Token")}>复制</button>
                            </dd>
                          </div>
                          <div>
                            <dt>App Password</dt>
                            <dd>
                              <code>{maskValue(account.appPassword, showSecrets)}</code>
                              <button type="button" className="ghost-btn" onClick={() => copyValue(account.appPassword, "App Password")}>复制</button>
                            </dd>
                          </div>
                          <div>
                            <dt>Authenticator URL</dt>
                            <dd>
                              {account.authenticatorUrl ? (
                                <>
                                  <a href={account.authenticatorUrl} target="_blank" rel="noreferrer">打开链接</a>
                                  <button type="button" className="ghost-btn" onClick={() => copyValue(account.authenticatorUrl, "Authenticator URL")}>复制</button>
                                </>
                              ) : (
                                <span>-</span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Messages URL</dt>
                            <dd>
                              {account.messagesUrl ? (
                                <>
                                  <a href={account.messagesUrl} target="_blank" rel="noreferrer">打开链接</a>
                                  <button type="button" className="ghost-btn" onClick={() => copyValue(account.messagesUrl, "Messages URL")}>复制</button>
                                </>
                              ) : (
                                <span>-</span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>备注</dt>
                            <dd>
                              <span>{account.note || "-"}</span>
                            </dd>
                          </div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}
            </article>
          </section>
        ) : (
          <section className="families-layout">
            <article className="section-card family-create-card">
              <h3>创建家庭组</h3>
              <p className="helper-text">家庭组页面只处理成员关系，不再混入账号编辑表单。</p>

              <form className="group-form" onSubmit={handleCreateGroup}>
                <label>
                  家庭组名称
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.currentTarget.value)}
                    placeholder="例如：家庭组 A"
                    required
                  />
                </label>
                <label>
                  管理员（必选）
                  <select
                    value={groupAdminId}
                    onChange={(event) => setGroupAdminId(event.currentTarget.value)}
                    required
                  >
                    <option value="">选择管理员账号</option>
                    {data.accounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.login}</option>
                    ))}
                  </select>
                </label>
                <label>
                  家庭组备注
                  <input
                    value={groupNote}
                    onChange={(event) => setGroupNote(event.currentTarget.value)}
                    placeholder="可选"
                  />
                </label>
                <button type="submit" disabled={saving || data.accounts.length === 0}>创建家庭组</button>
              </form>
            </article>

            <article className="section-card family-list-card">
              <h3>家庭组列表</h3>

              {data.groups.length === 0 ? (
                <p className="empty-text">还没有家庭组，先创建一个。</p>
              ) : (
                <div className="group-list">
                  {data.groups.map((group) => {
                    const admin = getGroupAdmin(group);
                    const members = sortMembers(group.members);
                    const memberOnlyCount = members.filter((member) => member.role === "member").length;
                    const draft = memberDrafts[group.id] || { accountId: "" };

                    return (
                      <article key={group.id} className="group-card">
                        <div className="group-head">
                          <div>
                            <h4>{group.name}</h4>
                            <p>{group.note || "无备注"}</p>
                            <p className="composition-line">
                              管理员: {admin ? accountMap.get(admin.accountId)?.login || "(账号已删除)" : "未设置"}
                              {" | "}
                              普通成员数: {memberOnlyCount}
                            </p>
                          </div>
                          <button type="button" className="danger-btn" onClick={() => handleDeleteGroup(group.id)}>删除家庭组</button>
                        </div>

                        <div className="role-grid">
                          <label>
                            更换管理员
                            <select
                              value={admin?.accountId || ""}
                              onChange={(event) => {
                                void handleAssignAdmin(group.id, event.currentTarget.value);
                              }}
                              disabled={saving}
                            >
                              <option value="">选择管理员</option>
                              {data.accounts.map((account) => (
                                <option key={account.id} value={account.id}>{account.login}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="member-editor">
                          <select
                            value={draft.accountId}
                            onChange={(event) => updateMemberDraft(group.id, event.currentTarget.value)}
                          >
                            <option value="">选择账号</option>
                            {data.accounts.map((account) => (
                              <option key={account.id} value={account.id}>{account.login}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => handleAddMember(group.id)}>添加普通成员</button>
                        </div>

                        {members.length === 0 ? (
                          <p className="empty-text">该家庭组暂无成员。</p>
                        ) : (
                          <ul className="member-list">
                            {members.map((member) => {
                              const account = accountMap.get(member.accountId);
                              const isAdmin = member.role === "admin";

                              return (
                                <li key={`${group.id}-${member.accountId}`}>
                                  <span>{account?.login || "(账号已删除)"}</span>
                                  <span className="tag">{roleLabel(member.role)}</span>
                                  {isAdmin ? (
                                    <span className="hint-text">管理员需先更换，不能直接移除</span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="ghost-btn"
                                      onClick={() => handleRemoveMember(group.id, member.accountId)}
                                    >
                                      移除
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </article>
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
