# 在晨羽智云部署并验证 DiffPipeForge

本文面向从晨羽智云应用市场、POD 应用或已保存镜像创建 Linux 实例的用户。主流程使用平台控制台和 DiffPipeForge WebUI，不要求普通用户通过 SSH 启动训练。

MiniMax H3 的参数含义、34 帧对齐、量化和 24GB 显存策略见 [MiniMax H3 训练参数与 24GB 显存指南](../models/minimax_h3_training_zh.md)。

> **界面待定：应用市场名称**
>
> 最终应用展示名和市场入口尚未写入本文。发布后将把下文的“DiffPipeForge 训练应用”替换为实际名称。不要选择 ComfyUI 推理应用，本流程需要带训练 WebUI 和完整 Linux 训练环境的 DiffPipeForge 应用。

## 1. 关键路径与存储边界

| 项目 | 晨羽实例中的位置或行为 |
| --- | --- |
| WebUI 服务 | `WebUI`，端口 `7860` |
| 项目源码 | `/workspace/DiffPipeForge` |
| 训练 Python | `/workspace/DiffPipeForge/.venv/bin/python` |
| WebUI 新项目根目录 | `/workspace/DiffPipeForge/output/<时间戳>` |
| 新训练的推荐输出目录 | `/usrdata/DiffPipeForge/<输出文件夹名称>`（仅在 `/usrdata` 为真实可写挂载时推荐） |
| 建议的持久数据集目录 | `/usrdata/DiffPipeForge/data/<数据集名称>` |
| 建议的持久训练输出根目录 | `/usrdata/DiffPipeForge/output` |
| 模型目录 | `/usrdata/models/MiniMax-H3` |
| `/usrdata` | 外部 NFS/数据盘，不属于镜像层 |
| `/workspace` | 实例根层/镜像侧，不应作为删除实例后的唯一备份 |

最重要的区别是：保存系统镜像不会把 `/usrdata` 打进镜像。模型、数据集和持久训练结果都应留在用户自己的 `/usrdata`，新实例还需要重新挂载或准备相同的数据盘路径。

项目配置仍创建在 `/workspace/DiffPipeForge/output`；训练页面会另行显示并保存“输出根目录”。当 `/usrdata` 是真实、可写的独立挂载时，WebUI 优先推荐 `/usrdata/DiffPipeForge`，最终只把标准 `output_dir` 写进训练配置。

镜像中不附带发布前使用的样例视频、旧项目和账号凭据。新实例没有现成数据集是正常现象。

## 2. 从应用市场或镜像创建实例

1. 打开晨羽智云的应用市场、POD 应用或个人镜像页面。
2. 选择“DiffPipeForge 训练应用”，核对说明中包含训练 WebUI，而不是 ComfyUI 推理工作流。
3. 选择至少 24GB 显存的 NVIDIA GPU。
4. 配置足够的系统盘空间，用于仓库、Python 环境、项目配置和临时缓存。
5. 挂载或创建 `/usrdata` 数据盘。模型和正式数据不要只放在镜像层。
6. 确认自定义服务类型为 HTTP/HTTPS WebUI，容器端口为 `7860`。
7. 创建并启动实例。

如果应用条目已经预设名为“WebUI”的 7860 服务，直接使用预设，不需要再添加第二个服务。镜像内部已配置启动方式，普通用户不需要填写 Python 命令。

> **安全要求：必须使用平台带身份验证的 WebUI/自定义服务入口。** 不要把容器的 `7860` 端口作为无鉴权公网直连地址暴露。平台代理必须同时保护普通 HTTP 请求和 WebSocket；如果平台不能提供鉴权代理，只能让服务监听本机地址并通过 SSH 隧道访问。DiffPipeForge WebUI 具备服务器文件、模型下载和训练操作能力，随机端口或难猜 URL 不能替代身份验证。

## 3. 打开 WebUI 并确认环境就绪

1. 等实例卡片显示运行中。
2. 打开实例卡片中的“自定义服务 WebUI”或应用详情页提供的 WebUI 链接。
3. 首次启动等待页面加载完成。
4. 确认左侧有“数据集设置”“训练配置”“开始训练”“全局监控”和“系统诊断”。
5. 打开“系统诊断”，确认 Python 环境已就绪。

WebUI 监听 7860 并能显示页面，只证明前端和服务进程正常。还需完成 3 步烟测，才能验证模型挂载、缓存、训练和保存链路。

## 4. 创建独立训练项目

1. 在主菜单选择“新建项目”。
2. WebUI 会在 `/workspace/DiffPipeForge/output` 下创建一个时间戳目录。
3. 为本次训练填写唯一的“输出文件夹名称”，例如 `minimax_h3_smoke_01`。
4. 每次正式训练新建项目，或至少使用新的输出名称，不要覆盖另一个会话。

默认目录结构如下：

```text
/workspace/DiffPipeForge/output/<项目时间戳>/
├── dataset.toml
├── evaldataset.toml
├── trainconfig.toml
└── minimax_h3_smoke_01/
```

在训练页面的“输出根目录”选择 `/usrdata/DiffPipeForge`，输出名称保持本会话唯一。页面会创建该目录并把组合后的标准 `output_dir` 写进 `trainconfig.toml`；界面专用的根目录状态不会写进 TOML。

“从检查点恢复”的下拉探测以当前训练配置的输出目录为边界。只要不同会话使用不同项目和输出目录，它们的检查点就不会互相混入。

## 5. 在 `/usrdata` 准备数据集

浏览器版可直接使用“选择视频和标注”，一次选择视频及同名、精确小写 `.txt` 标注，再点“上传并使用此数据集”。WebUI 会把数据上传到受控目录，并在配对和大小校验全部通过后填写服务器目录。已有云盘数据可点路径旁的文件夹按钮浏览或搜索服务器目录，不需要借助 Jupyter/SSH。

建议目录：

```text
/usrdata/DiffPipeForge/data/
└── character_a/
    ├── 001.mp4
    ├── 001.txt
    ├── 002.mp4
    ├── 002.txt
    ├── 003.mp4
    └── 003.txt
```

每个视频必须有同名 `.txt`。3 步烟测只放 3 个短视频及 3 个标注文件。在“数据集设置”的“输入路径”填写：

```text
/usrdata/DiffPipeForge/data/character_a
```

不要填写本机 `C:\...` 路径、单个视频文件路径或浏览器下载目录。

### 烟测数据集字段

| 字段 | 值 |
| --- | --- |
| 分辨率 | `[384]` |
| 启用宽高比分桶 | 启用 |
| 自定义宽高比分桶 | `[[16, 9]]` |
| 帧数分桶（视频） | `[34]` |
| 重复次数 | `1` |
| 验证集 | 禁用 |

当前 UI 默认还会保存最小宽高比 `0.5`、最大宽高比 `2.0` 和分桶数量 `7`。发布前实际烟测明确验证过的是 384 分辨率、16:9 自定义桶和 34 帧；其余默认值保持即可。

MiniMax H3 按 17 帧对齐，不能把界面的通用 33 帧占位值直接用于 H3。保存训练数据集配置后再进入模型设置。

## 6. 准备并填写四个模型路径

系统镜像不包含 `/usrdata`。训练页面的模型管理器可以浏览已有云盘模型、识别 MiniMax H3 四个文件，也可以选择 Hugging Face 或 ModelScope、固定 revision 和文件清单后由服务器断点下载到可写持久盘。令牌只从服务器环境变量读取，不写入 TOML 或任务日志。

推荐目录结构为：

```text
/usrdata/models/MiniMax-H3/
├── diffusion_models/
│   └── minimax_h3_fl2va_pruned_int8_convrot.safetensors
├── text_encoders/
│   └── qwen3vl_32b_minimax_h3_int8_convrot.safetensors
└── vae/
    ├── minimax_h3_video_vae_fp16.safetensors
    └── minimax_h3_audio_vae_fp32.safetensors
```

在“训练配置”把“模型架构”设为 `MiniMax H3`，再填写：

| WebUI 字段 | 晨羽路径 |
| --- | --- |
| Diffusion 模型路径 | `/usrdata/models/MiniMax-H3/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| VAE 路径 | `/usrdata/models/MiniMax-H3/vae/minimax_h3_video_vae_fp16.safetensors` |
| 音频 VAE 路径 | `/usrdata/models/MiniMax-H3/vae/minimax_h3_audio_vae_fp32.safetensors` |
| 文本编码器路径（Qwen3-VL） | `/usrdata/models/MiniMax-H3/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` |

四项都必填。模型文件位于外部数据盘，因此从同一系统镜像创建的新实例只有在挂载了对应 `/usrdata` 后，路径才会存在。

## 7. 填写 MiniMax H3 烟测参数

### 模型加载

- 基础数据类型：`bfloat16`；
- Diffusion 模型数据类型：`保留检查点原生量化`；
- 时间步采样方法：`uniform`；
- Shift：`8`；
- Image Shift：`1`；
- CFG 增强训练：`4`；
- 训练 / 去蒸馏适配器：留空。

选择“保留检查点原生量化”后，配置文件不会写 `diffusion_model_dtype`。这是为了保留 int8 convrot，不是遗漏。

### 训练和显存

- 批次大小（每 GPU）：`1`；
- 梯度累积步数：`1`；
- 管道并行阶段数：`1`；
- 激活检查点：`Unsloth（极致节省显存）`；
- 交换块数量：`48`；
- 缓存批次大小：`1`；
- 编译模型：首次烟测关闭。

### LoRA 与优化器

- 适配器类型：`LoRA`；
- Rank：`8`；
- 适配器数据类型：`bfloat16`；
- 优化器：`AdamW Optimi`；
- 学习率：`1e-4`。

### 3 步停止与保存

- 最大训练步数：`3`；
- 每 N 步保存模型：`3`；
- 日志打印间隔步数：`1`；
- 验证集：禁用。

保存配置前再次确认 CFG 为 4、训练适配器为空、管道并行阶段数为 1。不要使用“跳过检查”绕过 MiniMax H3 校验。

## 8. 通过 WebUI 跑 3 个训练步

1. 打开“开始训练”。
2. 核对配置概览中的模型、数据集和输出目录。
3. 第一次烟测把“从检查点恢复”留空。
4. 单卡实例的 GPU 数量填 `1`。
5. 点击“开始训练”。
6. 等待模型加载和数据缓存。int8 Qwen3-VL 文本编码器约 26GB，缓存阶段比 3 个训练步长是正常现象。
7. 观察实时训练日志，等待 3 个有限 loss。
8. 确认日志末尾出现 `TRAINING COMPLETE!`。

发布前已用这套 384 分辨率、34 帧、16:9、CFG 4、rank 8、Unsloth、交换 48 个块的组合完成过 3 步训练，并得到有限 loss、最终 LoRA 和 `global_step3` 检查点。

## 9. 检查 loss、权重和 checkpoint

### 在 WebUI 中检查

1. 实时训练日志中应有 3 个训练步，没有 traceback。
2. loss 必须是有限数字，没有 `NaN` 或 `Inf`。3 步内无需单调下降。
3. 打开“全局监控”，选择本次运行的日志目录，检查 `train/loss`。
4. 在“开始训练”页确认实际输出目录。

### 运行根目录应包含

- `step3/adapter_model.safetensors`，或同类最终 LoRA 保存目录；
- `events.out.tfevents...`；
- `latest`；
- `global_step.../`；
- `global_step...` 中非空的 `*_model_states.pt`。

从检查点恢复时，选择包含 `latest` 的运行根目录，不要选择 `latest` 文件、`global_step...` 子目录或 LoRA 文件。恢复路径只作为启动参数发送，不会写进 `trainconfig.toml`。

## 10. 确认输出进入持久存储

在训练页面确认“输出根目录”为 `/usrdata/DiffPipeForge`。若 `/usrdata` 没有真实挂载、只读或不存在，WebUI 不会把它伪装成持久盘，也不会自动创建假的根目录。

目标结构应类似：

```text
/usrdata/DiffPipeForge/output/
└── my_minimax_h3_run/
    ├── latest
    ├── global_step.../
    ├── events.out.tfevents...
    └── step.../
        └── adapter_model.safetensors
```

保存训练配置后可打开项目中的 `trainconfig.toml` 复核 `output_dir`。它应等于所选根目录与本次输出名称的组合；不同会话使用不同输出名称后，检查点探测也只扫描各自目录。

## 11. 把烟测改为正式训练

1. 新建项目或更换输出名称，保留烟测目录。
2. 确认模型和完整数据集都位于 `/usrdata`。
3. 确认新版 WebUI 显示的训练输出目录也位于 `/usrdata/DiffPipeForge/output`。
4. 把输入路径换成完整数据集。
5. 按视频长度增加 17 的倍数帧桶，例如 `[34, 68, 102]`。
6. 按真实素材比例配置宽高比桶。
7. 清空或删除“最大训练步数 = 3”的限制。
8. 重新设置 epoch、保存间隔、验证集和 LoRA rank。
9. 先保留 Unsloth 与 `blocks_to_swap=48`，稳定后再优化速度。

## 12. 停止训练、保存镜像和关机

### 正常结束后

1. 等待 `TRAINING COMPLETE!`。
2. 确认 LoRA、TensorBoard 事件、`latest` 和 `global_step...` 已写完。
3. 若运行仍在 `/workspace`，先通过 WebUI/平台文件管理把重要结果下载或转存到 `/usrdata`。
4. 确认没有训练任务仍在写文件。
5. 回到晨羽控制台选择关机，或按需要使用“存储为镜像并关机”。

### “存储为镜像并关机”不会保存什么

`/usrdata` 是外部存储，不会被打入系统镜像。保存镜像后：

- 系统环境、仓库、`.venv` 和启动脚本属于镜像侧；
- `/usrdata/models`、`/usrdata/DiffPipeForge/data` 和 `/usrdata/DiffPipeForge/output` 仍属于外部数据盘；
- 从该镜像创建新实例时，仍需挂载自己的 `/usrdata`；
- 不应把外部模型或训练结果是否存在，作为镜像本身是否制作成功的唯一判断。

### 中途停止

先在 WebUI 点击“停止训练”，等待进程退出，再执行平台关机。不要在 checkpoint 正在写入时强制关机或删除数据盘。

## 13. 管理员排障附录（普通用户不必操作）

镜像中的启动事实如下，供平台维护者核验，普通用户无需手动执行：

- PID 1 的 `/root/start.sh` 会在后台调用 `/workspace/start_diffpipe_web.sh`；
- WebUI 使用 `/workspace/DiffPipeForge/.venv/bin/python`；
- 服务监听 `0.0.0.0:7860`；
- 本机健康检查目标为 `127.0.0.1:7860`；
- 项目仓库是 `/workspace/DiffPipeForge`；
- 模型和持久输出位于外部 `/usrdata`，不属于系统镜像。

发布前验收曾在外部目录 `/usrdata/DiffPipeForge/output/chenyu_ui_smoke/20260809_17-57-06` 完成 3 个训练步。该目录属于验收账号的数据盘，不保证出现在其他用户的新实例中。

如果 WebUI 页面打不开，维护者应先检查 7860 服务映射、启动脚本和 Python 就绪状态，不要直接替换当前 PyTorch 或删除 `.venv`。
