# DiffPipe Forge (Diffusion Pipe Forge)

[English](README.md) | [简体中文](README_zh.md)

<div align="center">
  <img src="app/ui/public/icon.png" alt="DiffPipe Forge" width="256">
</div>

**DiffPipe Forge** 是一款专为训练最先进的扩散模型而设计的高级、高性能图形界面（GUI）。基于 Electron 和 React 开发，它为研究人员和 AI 爱好者提供了一个视觉惊艳且操作流畅的平台，能够精确且轻松地微调模型。

> [!NOTE]
> **项目声明**：本项目是针对 [tdrussell](https://github.com/tdrussell) 开发的 [diffusion-pipe](https://github.com/tdrussell/diffusion-pipe) 原项目的 GUI 封装。我们主要负责用户界面（UI）与交互体验的构建，核心训练逻辑完全由原作者的卓越工作驱动。

## 📸 界面预览

<div align="center">
  <img src="asset/1.png" width="45%" />
  <img src="asset/4.png" width="45%" />
  <br />
  <img src="asset/3.png" width="45%" />
  <img src="asset/2.png" width="45%" />
  <br />
  <img src="asset/5.png" width="45%" />
  <img src="asset/6.png" width="45%" />
  <br />
  <img src="asset/7.png" width="90.5%" />
</div>

## ✨ 核心特性

- **🚀 广泛的模型支持**：支持多种架构，包括：
  - **视频模型**：LTX-Video, Hunyuan Video (1.0 & 1.5), Wan (2.1 & 2.2), Cosmos。
  - **图像模型**：Flux (Dev/Schnell), SDXL, Lumina 2.0, SD3/3.5, Qwen-Image。
  - **专用模型**：Chroma, HiDream, OmniGen2, AuraFlow, Z-Image。
- **📊 先进的数据集管理**：
  - 灵活支持图像和视频数据集。
  - 内置分辨率和宽高比分桶（AR Buckets）。
  - 支持多路径数据集配置及循环次数（Repeats）设置。
- **🛠️ 专业训练工具**：
  - 支持 **LoRA** 和 **全量微调 (FFT)**。
  - **显存优化**：支持分块交换（Block swapping）、激活检查点（Activation checkpointing）以及 8-bit 优化器，可在消费级显卡（如 24GB 显存）上进行训练。
  - 适配多种优化器：AdamW, AdamW8bitKahan, Prodigy 等。
- **👁️ 实时监控**：
  - 集成 **TensorBoard** 查看器。
  - 支持 **Weights & Biases (WandB)** 集成。
  - 专用的 **实时训练日志** 页面，支持导出功能。
- **🎨 极致体验**：
  - 现代感十足的 **玻璃拟态 (Glassmorphism)** 设计系统。
  - 完美支持 **深色模式** 和 **浅色模式**。
  - **多语言** 支持（中英文切换）。

## 🛠️ 项目结构

```text
DiffPipeForge/
├── app/                # 主应用程序代码 (Electron/React)
├── train_config/       # 默认配置文件目录
├── output/             # 训练输出（检查点、日志、配置文件）
├── start.bat           # 启动应用程序的主入口
└── requirements.txt    # Python 依赖项
```

## 🚀 快速入门

### 前置条件

  **Python 环境**：确保已安装 Python 3.10+。

```bash
    git clone --recurse-submodules https://github.com/TianDongL/DiffPipeForge.git
```

  **安装依赖**：
```bash
    pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
```
```bash
    pip install -r requirements.txt
```
    

### 启动应用

直接运行根目录下的 `start.bat` 文件：
```bash
./start.bat
```

### 开启第一次训练

1.  **选择/创建项目**：启动应用后，创建一个新项目或打开已有文件夹。
2.  **配置数据集**：指定图像或视频文件夹路径，并设置分辨率。
3.  **配置模型**：选择架构（如 Flux 或 Wan）并提供模型路径。
4.  **优化器与训练**：调整学习率和 Batch Size。
5.  **开始训练**：点击 "开始训练" 按钮，在 "训练日志" 或 "训练监控" 标签页查看进度。

## 📖 相关文档

有关详细的配置示例和特定模型的说明，请参阅：
- [支持模型指南](supported_models.md)
- [示例配置文件](examples/)

