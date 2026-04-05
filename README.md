# AnyGen 本地工作台

一个本地运行的 AnyGen 工作台，支持：

- 手动发提示词
- 上传参考图 / 参考文档
- 扫描文件夹批量处理
- 导入 `.xlsx` / `.csv` 表格批量处理
- 每天定时运行
- 把文档、图片、任务摘要直接保存到本地目录

## 启动

```bash
npm install
npm start
```

启动后打开：

```text
http://127.0.0.1:4318
```

也可以直接双击根目录里的 `一键启动.bat` 或 `一键启动.vbs`。

## 发给朋友直接用

如果你想把它打包后直接发给别人，现在有两种方式：

```bash
npm run build-portable
npm run build-installer
```

打包完成后会生成：

- `release/AnyGen-Workbench-Portable`
- `release/AnyGen-Workbench-Portable-v1.0.0.zip`
- `release/AnyGen-Workbench-Installer-v1.0.0.exe`

推荐这样理解：

- `Portable.zip`：适合熟悉电脑的人，解压后直接双击运行
- `Installer.exe`：适合普通用户，双击安装后桌面会生成快捷方式

便携版 / 安装包都会自带：

- 项目代码
- 已安装的依赖
- 可携带的 Node.js 运行时
- 一键启动脚本

朋友拿到后只需要：

1. 如果是 `Installer.exe`，双击安装
2. 如果是 `Portable.zip`，完整解压后双击 `一键启动.bat` 或 `一键启动.vbs`
3. 第一次打开后填入自己的 AnyGen API Key

## GitHub 发布

仓库已经适合直接走 GitHub 发布流程：

- 平时开发改动可以走分支和 PR
- 需要给别人下载时，可以把 `release/` 里的 zip / exe 上传到 GitHub Release
- 后续也可以接 GitHub Actions，在打 tag 时自动生成发布包

## 文件夹批量规则

- 每个子文件夹视为一个任务
- 优先读取 `prompt.md` 或 `prompt.txt`
- 同目录下的图片、PDF、Word、PPT、表格会自动作为参考附件上传
- 如果没有 prompt 文件，就使用界面里的“兜底提示词”
- 默认把结果保存回原文件夹

## 表格批量规则

支持列名：

- `name`
- `prompt`
- `reference_dir`
- `output_dir`
- `operation`
- `style`
- `language`

也兼容中文列名：

- `名称`
- `提示词`
- `参考目录`
- `输出目录`
- `操作类型`
- `风格`
- `语言`

## 系统定时

界面里点“注册系统定时”即可，也可以手动执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-daily-task.ps1 -Time 09:00
```
