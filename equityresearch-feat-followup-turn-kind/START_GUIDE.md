<div align="center">

# 🚀 快速启动指南

**Equity Research Analyst - 智能股票投研分析平台**

[完整文档](README.md) • [技术栈](README.md#🛠️-技术栈) • [API 文档](README.md#🔌-api-接口文档)

</div>

---

## ⚡ 一键启动（推荐）

### 前置要求

- ✅ Node.js >= 18.0.0
- ✅ npm >= 9.0.0  
- ✅ 已获取 API Keys（DeepSeek、Perplexity、OpenAI）

### 快速开始

```bash
# 1. 克隆项目
git clone <repository-url>
cd WorkflowDemo

# 2. 安装依赖
npm install

# 3. 配置环境变量
cat > .env.local << EOF
DEEPSEEK_API_KEY=your_deepseek_key_here
PERPLEXITY_API_KEY=your_perplexity_key_here
OPENAI_API_KEY=your_openai_key_here
EOF

# 4. 启动开发服务器
npm run dev
```

**访问应用**:
- 🌐 前端: http://localhost:5173
- 🔌 后端: http://localhost:5000

---

## 🐍 完整启动（包含 Python 服务）


### 方式一：使用 npm 脚本（推荐）

```bash
# 同时启动所有服务（Node.js + 2个 Python 服务）
npm run dev:all
```

这将自动启动：
- ✅ Node.js 后端服务 (5000)
- ✅ 财务性能分析服务 (8502)
- ✅ 估值分析服务 (8501)

### 方式二：分别启动（开发调试）

打开 **3 个终端**，分别运行：

**终端 1: Node.js 服务**
```bash
npm run dev
```
等待看到: `🟢 Server running at http://localhost:5000`

**终端 2: 财务性能服务**
```bash
# Windows
cd python-services/performance
start.bat

# 或直接运行
npm run start:python:performance
```
等待看到: `🚀 Performance Metrics API starting on port 8502...`

**终端 3: 估值分析服务**
```bash
# Windows  
cd python-services/valuation
start.bat

# 或直接运行
npm run start:python:valuation
```
等待看到: `🚀 Valuation API starting on port 8501...`

---

## 📊 服务端口一览

| 服务 | 端口 | 说明 | 状态检查 |
|------|------|------|---------|
| 前端 (Vite Dev) | 5173 | React 开发服务器 | http://localhost:5173 |
| 后端 (Express) | 5000 | Node.js API | http://localhost:5000/api/test |
| Python 性能服务 | 8502 | 财务指标分析 | http://localhost:8502/api/health |
| Python 估值服务 | 8501 | DCF/相对估值 | http://localhost:8501/health |

---

## 🔧 Python 依赖安装（首次启动需要）

如果 Python 服务无法启动，需要手动安装依赖：

### Performance 服务

```bash
cd python-services/performance
pip install -r requirements.txt
cd ../..
```

### Valuation 服务

```bash
cd python-services/valuation
pip install -r requirements.txt
cd ../..
```

**推荐使用虚拟环境**:

```bash
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境 (Windows)
venv\Scripts\activate

# 激活虚拟环境 (Linux/Mac)
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

---

## ✅ 验证安装

### 1. 检查后端服务

```bash
curl http://localhost:5000/api/test
```

**预期响应**:
```json
{
  "message": "API is working!",
  "environment": {
    "deepseek_configured": true,
    "perplexity_configured": true,
    "openai_configured": true
  }
}
```

### 2. 检查 Python 服务

```bash
# 检查性能服务
curl http://localhost:8502/api/health

# 检查估值服务
curl http://localhost:8501/health
```

### 3. 访问前端

打开浏览器，访问 http://localhost:5173，应该看到应用界面。

---

## ⚠️ 常见问题

### ❓ 端口被占用

**问题**: 提示端口 5000/5173/8501/8502 已被占用

**解决方案**:

```bash
# Windows - 查找占用端口的进程
netstat -ano | findstr :5000
# 记下最后一列的 PID，然后结束进程
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:5000 | xargs kill -9
```

### ❓ Python 依赖缺失

**问题**: `ModuleNotFoundError: No module named 'flask'`

**解决方案**:

```bash
# 安装 Performance 服务依赖
cd python-services/performance
pip install -r requirements.txt

# 安装 Valuation 服务依赖
cd ../valuation
pip install -r requirements.txt
```

### ❓ API 调用失败

**问题**: 前端显示 "API 调用失败"

**检查清单**:
1. ✅ 确认 Performance API 已启动 (8502)
2. ✅ 确认 Valuation API 已启动 (8501)
3. ✅ 确认 `.env.local` 文件存在且配置正确
4. ✅ 检查浏览器控制台的错误信息

**验证方法**:
```bash
# 测试 Performance API
curl http://localhost:8502/api/health

# 测试 Valuation API
curl http://localhost:8501/health

# 测试主后端
curl http://localhost:5000/api/test
```

### ❓ 环境变量未生效

**问题**: API Keys 未被识别

**解决方案**:
1. 确认 `.env.local` 文件位于项目根目录
2. 确认文件名正确（不是 `.env.local.txt`）
3. 重启开发服务器：`Ctrl+C` 然后 `npm run dev`
4. 检查是否包含 BOM 字符（用记事本另存为 UTF-8 无 BOM）

### ❓ Python 版本问题

**问题**: Python 版本过低

**解决方案**:
```bash
# 检查 Python 版本（需要 >= 3.8）
python --version

# 如果版本过低，安装最新版本
# Windows: 从 python.org 下载安装
# Linux: sudo apt install python3.10
# Mac: brew install python@3.10
```

### ❓ npm install 失败

**问题**: 依赖安装出错

**解决方案**:
```bash
# 清除缓存重新安装
rm -rf node_modules package-lock.json
npm cache clean --force
npm install

# 如果仍然失败，尝试使用国内镜像
npm config set registry https://registry.npmmirror.com
npm install
```

---

## 📚 更多资源

- 📖 [完整文档](README.md)
- 🔌 [API 接口文档](README.md#🔌-api-接口文档)
- 🛠️ [技术栈详情](README.md#🛠️-技术栈)
- 🏗️ [系统架构](README.md#🏗️-系统架构)
- 🚢 [部署指南](README.md#🚢-部署指南)

---

## 💡 提示

- 🔥 首次启动建议使用 `npm run dev:all` 一键启动所有服务
- 🐛 遇到问题先查看浏览器控制台和终端日志
- 📝 开发时可以只启动 Node.js 服务，Python 服务为可选
- 🚀 生产环境使用 `npm run build && npm start`

---

<div align="center">

**需要帮助？** 查看 [完整文档](README.md) 或提交 [Issue](https://github.com/your-repo/issues)

Made with ❤️ by CheckIT Analytics Team

</div>
