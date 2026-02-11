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

// Icons
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {off ? (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </>
    ) : (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </>
    )}
  </svg>
);

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

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

  const [activeView, setActiveView] = useState<ViewMode>("accounts");

  const [query, setQuery] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"manual" | "import">("manual");

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
        const loaded = await invoke<AppData>("load_data");
        setData(loaded);
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
      setIsModalOpen(false);
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
        setIsModalOpen(false);
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
      setIsModalOpen(false);
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
    setModalTab("manual");
    setIsModalOpen(true);
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
      setIsModalOpen(false);
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
    : "独立管理家庭组结构。";

  if (loading) {
    return (
      <div className="app-shell">
        <main className="main-content">
          <div className="empty-state">正在加载本地数据...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Gmail Control</h1>
          <p>Account Workspace</p>
        </div>

        <nav className="nav-menu">
          <button
            type="button"
            className={`nav-item ${activeView === "accounts" ? "active" : ""}`}
            onClick={() => setActiveView("accounts")}
          >
            账号管理
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "families" ? "active" : ""}`}
            onClick={() => setActiveView("families")}
          >
            家庭组管理
          </button>
        </nav>

        <div className="metrics">
          <div className="metric-item">
            <span className="metric-label">账号总数</span>
            <span className="metric-value">{data.accounts.length}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">已入组</span>
            <span className="metric-value">{linkedAccountCount}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">家庭组</span>
            <span className="metric-value">{data.groups.length}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div className="page-title">
            <h2>{pageTitle}</h2>
            <p className="page-description">{pageDescription}</p>
          </div>
          <div className="flex gap-2 items-center">
            {activeView === "accounts" ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    resetEditor();
                    setModalTab("manual");
                    setIsModalOpen(true);
                  }}
                >
                  <PlusIcon /> 新增账号
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveView("families")}>去家庭组页</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setActiveView("accounts")}>去账号页</button>
            )}
            <span className={`badge ${saving ? "saving" : ""}`} style={{ backgroundColor: saving ? "var(--primary-light)" : "var(--bg-subtle)" }}>
              {saving ? "保存中..." : "已保存"}
            </span>
          </div>
        </header>

        {notice ? (
          <div className={`notice notice-${notice.type}`}>
            {notice.text}
          </div>
        ) : null}

        {activeView === "accounts" ? (
          <>
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">账号列表</h3>
                <div className="flex gap-2 items-center">
                  <div style={{ position: "relative" }}>
                     <input
                      className="form-input"
                      style={{ paddingLeft: "2rem", width: "240px" }}
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                      placeholder="搜索..."
                    />
                    <div style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                      <SearchIcon />
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowSecrets(!showSecrets)}>
                    <EyeIcon off={!showSecrets} />
                    <span style={{ marginLeft: "0.5rem" }}>{showSecrets ? "隐藏" : "显示"}</span>
                  </button>
                </div>
              </div>

              {filteredAccounts.length === 0 ? (
                <div className="empty-state">没有找到匹配的账号。</div>
              ) : (
                <div className="account-list">
                  {filteredAccounts.map((account) => {
                    const groups = accountToGroupMap.get(account.id) || [];
                    return (
                      <div key={account.id} className="account-item">
                        <div className="account-header">
                          <div>
                            <div className="account-login">{account.login}</div>
                            <div className="account-meta">
                              {groups.length === 0 && <span className="badge">未分组</span>}
                              {groups.map((groupName) => (
                                <span key={groupName} className="badge" style={{ backgroundColor: "var(--primary-light)", color: "var(--primary)" }}>{groupName}</span>
                              ))}
                              {account.note && <span className="badge">{account.note}</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => beginEditAccount(account)} title="编辑">
                              <EditIcon />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteAccount(account.id)} title="删除">
                              <TrashIcon />
                            </button>
                          </div>
                        </div>

                        <div className="account-details">
                          <div className="detail-item">
                            <div className="detail-label">密码</div>
                            <div className="detail-value">
                              {maskValue(account.password, showSecrets)}
                              <button className="icon-btn" onClick={() => copyValue(account.password, "密码")}>
                                <CopyIcon />
                              </button>
                            </div>
                          </div>
                          <div className="detail-item">
                            <div className="detail-label">Token</div>
                            <div className="detail-value">
                              {maskValue(account.authenticatorToken, showSecrets)}
                              <button className="icon-btn" onClick={() => copyValue(account.authenticatorToken, "Token")}>
                                <CopyIcon />
                              </button>
                            </div>
                          </div>
                          <div className="detail-item">
                            <div className="detail-label">App Password</div>
                            <div className="detail-value">
                              {maskValue(account.appPassword, showSecrets)}
                              <button className="icon-btn" onClick={() => copyValue(account.appPassword, "App Password")}>
                                <CopyIcon />
                              </button>
                            </div>
                          </div>
                          {account.authenticatorUrl && (
                            <div className="detail-item">
                              <div className="detail-label">Auth URL</div>
                              <div className="detail-value">
                                <a href={account.authenticatorUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>链接</a>
                                <button className="icon-btn" onClick={() => copyValue(account.authenticatorUrl, "Auth URL")}>
                                  <CopyIcon />
                                </button>
                              </div>
                            </div>
                          )}
                           {account.messagesUrl && (
                            <div className="detail-item">
                              <div className="detail-label">Msg URL</div>
                              <div className="detail-value">
                                <a href={account.messagesUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>链接</a>
                                <button className="icon-btn" onClick={() => copyValue(account.messagesUrl, "Msg URL")}>
                                  <CopyIcon />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">创建家庭组</h3>
              </div>
              <form onSubmit={handleCreateGroup}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "1rem", alignItems: "end" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">名称</label>
                    <input
                      className="form-input"
                      value={groupName}
                      onChange={(event) => setGroupName(event.currentTarget.value)}
                      placeholder="家庭组名称"
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">管理员</label>
                    <select
                      className="form-select"
                      value={groupAdminId}
                      onChange={(event) => setGroupAdminId(event.currentTarget.value)}
                      required
                    >
                      <option value="">选择管理员...</option>
                      {data.accounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.login}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">备注</label>
                    <input
                      className="form-input"
                      value={groupNote}
                      onChange={(event) => setGroupNote(event.currentTarget.value)}
                      placeholder="可选"
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={saving || data.accounts.length === 0}>
                    创建
                  </button>
                </div>
              </form>
            </div>

            <div className="account-list">
              {data.groups.length === 0 ? (
                 <div className="empty-state">还没有家庭组。</div>
              ) : (
                data.groups.map((group) => {
                  const admin = getGroupAdmin(group);
                  const members = sortMembers(group.members);
                  const draft = memberDrafts[group.id] || { accountId: "" };

                  return (
                    <div key={group.id} className="card" style={{ marginBottom: 0 }}>
                      <div className="card-header">
                        <div>
                          <h4 className="card-title">{group.name}</h4>
                          <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "var(--text-muted)" }}>{group.note || "无备注"}</p>
                        </div>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteGroup(group.id)}>
                          <TrashIcon /> 删除
                        </button>
                      </div>

                      <div style={{ background: "var(--bg-subtle)", padding: "1rem", borderRadius: "var(--radius)", marginBottom: "1rem" }}>
                         <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "1rem", alignItems: "center" }}>
                            <div>
                              <div className="form-label">管理员: <strong>{admin ? accountMap.get(admin.accountId)?.login || "(已删)" : "无"}</strong></div>
                              <select
                                className="form-select"
                                style={{ marginTop: "0.5rem" }}
                                value={admin?.accountId || ""}
                                onChange={(e) => void handleAssignAdmin(group.id, e.target.value)}
                                disabled={saving}
                              >
                                <option value="">更换管理员...</option>
                                {data.accounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>{acc.login}</option>
                                ))}
                              </select>
                            </div>
                         </div>
                      </div>

                      <div className="form-group">
                         <label className="form-label">成员列表</label>
                         <div className="account-list" style={{ gap: "0.5rem" }}>
                           {members.map((member) => {
                              const account = accountMap.get(member.accountId);
                              const isAdmin = member.role === "admin";
                              return (
                                <div key={`${group.id}-${member.accountId}`} className="detail-value" style={{ background: "white", border: "1px solid var(--border)" }}>
                                  <div className="flex items-center gap-2">
                                    <span>{account?.login || "(未知)"}</span>
                                    {isAdmin ? (
                                      <span className="badge" style={{ background: "var(--primary)", color: "white" }}>Admin</span>
                                    ) : (
                                      <span className="badge">Member</span>
                                    )}
                                  </div>
                                  {!isAdmin && (
                                    <button className="btn btn-ghost btn-sm" style={{ padding: "0.25rem" }} onClick={() => handleRemoveMember(group.id, member.accountId)}>
                                      移除
                                    </button>
                                  )}
                                </div>
                              );
                           })}
                         </div>
                      </div>

                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "1rem" }}>
                         <div className="flex gap-2">
                            <select
                              className="form-select"
                              value={draft.accountId}
                              onChange={(e) => updateMemberDraft(group.id, e.target.value)}
                            >
                              <option value="">选择要添加的成员...</option>
                              {data.accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>{acc.login}</option>
                              ))}
                            </select>
                            <button className="btn btn-primary" onClick={() => handleAddMember(group.id)}>添加</button>
                         </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingAccountId ? "编辑账号" : "新增账号"}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            {!editingAccountId && (
              <div className="modal-tabs">
                <button
                  className={`modal-tab ${modalTab === "manual" ? "active" : ""}`}
                  onClick={() => setModalTab("manual")}
                >
                  手动添加
                </button>
                <button
                  className={`modal-tab ${modalTab === "import" ? "active" : ""}`}
                  onClick={() => setModalTab("import")}
                >
                  批量导入
                </button>
              </div>
            )}

            <div className="modal-body">
              {modalTab === "import" && !editingAccountId ? (
                <>
                  <textarea
                    className="form-textarea"
                    value={importText}
                    onChange={(event) => setImportText(event.currentTarget.value)}
                    placeholder="每行一条，支持：login password [token] [app_pass] [url] [msg_url]"
                    rows={10}
                    style={{ fontFamily: "monospace" }}
                  />
                  <div className="mt-4">
                    <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing || saving}>
                      {importing ? "导入中..." : "导入并合并"}
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleSaveAccount}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label className="form-label">Gmail 登录账号</label>
                      <input
                        className="form-input"
                        value={form.login}
                        onChange={(event) => setForm({ ...form, login: event.currentTarget.value })}
                        placeholder="name@gmail.com"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">登录密码</label>
                      <input
                        className="form-input"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                        placeholder="Password"
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label className="form-label">Authenticator Token (TOTP)</label>
                      <input
                        className="form-input"
                        value={form.authenticatorToken}
                        onChange={(event) => setForm({ ...form, authenticatorToken: event.currentTarget.value })}
                        placeholder="Token"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">App Password</label>
                      <input
                        className="form-input"
                        value={form.appPassword}
                        onChange={(event) => setForm({ ...form, appPassword: event.currentTarget.value })}
                        placeholder="App specific password"
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div className="form-group">
                      <label className="form-label">Authenticator URL</label>
                      <input
                        className="form-input"
                        value={form.authenticatorUrl}
                        onChange={(event) => setForm({ ...form, authenticatorUrl: event.currentTarget.value })}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Messages URL</label>
                      <input
                        className="form-input"
                        value={form.messagesUrl}
                        onChange={(event) => setForm({ ...form, messagesUrl: event.currentTarget.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">备注</label>
                    <input
                      className="form-input"
                      value={form.note}
                      onChange={(event) => setForm({ ...form, note: event.currentTarget.value })}
                      placeholder="可选备注"
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? "保存中..." : editingAccountId ? "保存修改" : "新增账号"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
