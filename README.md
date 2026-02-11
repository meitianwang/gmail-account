# Gmail Account Manager (Tauri)

一个基于 Tauri + React 的 Gmail 账号管理工具，支持：

- 批量导入账号（按邮箱自动去重，存在则更新）
- 手动新增 / 编辑 / 删除账号
- 管理家庭组关系（每组仅 `管理员(admin)` + `普通成员(member)`）
- 本地 JSON 持久化（关闭应用后数据保留）

## 开发运行

```bash
npm install
npm run tauri dev
```

## 打包构建

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 导入格式

每条记录以 `login` 开头，最少 2 个字段（`login/password`），其余可选：

```text
{login};{password};{authenticatorToken};{appPassword};{authenticatorUrl};{messagesUrl}
```

如果有第 7 个及以上字段，不会报错，会自动写入账号备注。

支持两种粘贴方式：

1. 一行一个账号（分号分隔）
2. 多行粘贴（每个字段单独一行，行尾带分号也可）

你的示例可以直接粘贴进「批量导入账号」文本框。

## 数据文件

应用会把数据存到系统应用目录，文件名为：

```text
gmail_manager_data.json
```

实际绝对路径会显示在应用顶部「本地数据文件」位置。
