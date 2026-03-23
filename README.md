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

如果你想把它打包后直接发给别人，推荐先生成便携版：

```bash
npm run build-portable
```

打包完成后会生成：

- `release/AnyGen-Workbench-Portable`
- `release/AnyGen-Workbench-Portable-v1.0.0.zip`

便携版会自带：

- 项目代码
- 已安装的依赖
- 可携带的 Node.js 运行时
- 一键启动脚本

朋友拿到后只需要：

1. 完整解压压缩包
2. 双击 `一键启动.bat` 或 `一键启动.vbs`
3. 第一次打开后填入自己的 AnyGen API Key

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
