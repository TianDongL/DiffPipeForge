# 在优云智算部署并验证 DiffPipeForge

本文面向从优云智算镜像市场或私有镜像创建 Linux 实例的用户，主流程全部通过平台控制台和 DiffPipeForge WebUI 完成。第一次使用 MiniMax H3 时，先按本文跑通 3 个训练步，再开始正式训练。

MiniMax H3 的字段解释和 24GB 参数原理见 [MiniMax H3 训练参数与 24GB 显存指南](../models/minimax_h3_training_zh.md)。

> **界面待定：镜像名称**
>
> 镜像市场最终展示名尚未写入本文。发布后将把下文的“DiffPipeForge 训练镜像”替换为实际名称。不要选择 ComfyUI 推理镜像；本流程需要的是带训练 WebUI、Linux 训练环境和完整模型模块的 DiffPipeForge 镜像。

## 1. 关键路径与持久化边界

| 项目 | 优云实例中的位置或行为 |
| --- | --- |
| WebUI 端口 | `7860` |
| 项目源码 | `/workspace/DiffPipeForge` |
| 训练 Python | `/usr/local/miniconda3/envs/py312/bin/python` |
| WebUI 新项目根目录 | `/workspace/DiffPipeForge/output/<时间戳>` |
| 新训练的默认输出目录 | `/workspace/DiffPipeForge/output/<时间戳>/<输出文件夹名称>` |
| 建议的数据集目录 | `/workspace/data/<数据集名称>` |
| 模型挂载根目录 | `/model`，只读 |
| 关机再开机 | `/workspace` 中本实例的数据仍在 |
| 删除实例或从原镜像另开实例 | 本次写入 `/workspace` 的项目和输出不会自动出现 |

`/model` 是独立的只读模型挂载，只能读取模型，不能保存数据集、LoRA、日志或检查点。`/workspace` 是实例系统盘/镜像层：普通关机不会清空，但删除实例前必须另做镜像、下载结果或复制到另行挂载的持久存储。

当前发布前验收已清除烟测数据集和旧训练输出。新实例中看不到示例项目、loss 或 checkpoint 是正常现象，不代表镜像不完整。

## 2. 从镜像市场创建实例

1. 打开优云智算的镜像市场或私有镜像页面。
2. 选择“DiffPipeForge 训练镜像”。确认详情页描述的是训练器，而不是 ComfyUI 推理环境。
3. 选择至少 24GB 显存的 NVIDIA GPU。24GB 是本文 MiniMax H3 int8 LoRA 烟测的最低验证档位；显存更大的卡可以在跑通后提高分辨率或降低块交换数量。
4. 保留足够的系统盘空间。模型从 `/model` 只读挂载，但数据集缓存、项目、日志、检查点和 LoRA 会写入 `/workspace`。
5. 在模型选择或模型盘挂载步骤中，挂载 MiniMax H3 的 ModelScope 模型目录，最终应出现在 `/model/ModelScope/Comfy-Org/MiniMax-H3`。
6. 在应用设置中选择 `SD-WebUI:7860`。JupyterLab `8888` 可作为高级文件管理入口保留，但 DiffPipeForge 登录不依赖它，也不要用它覆盖 7860。
7. 创建并启动实例。

如果镜像市场条目已经提供“WebUI”应用入口并预设 7860，直接沿用预设即可，无需重复创建第二个端口映射。

> **安全要求：镜像启动脚本必须设置 `DIFFPIPE_WEB_AUTH=youyun`。** 优云的 7860 应用代理本身不提供登录保护；镜像内的登录层会同时拦截普通 HTTP API 和 WebSocket。随机端口或难猜 URL 不能替代身份验证。

## 3. 打开 WebUI 并确认就绪

镜像内已经配置自动启动。实例进入运行状态后：

1. 在当前实例卡片中找到并复制“SSH 端口”和“实例密码”。这里的复制只是为了 WebUI 身份验证，不需要打开 SSH 客户端、终端或执行命令。
2. 打开 7860 对应的 WebUI，在中英双语登录页分别粘贴这两个字段。验证成功后浏览器会收到带 `HttpOnly`、`Secure` 和 `SameSite=Strict` 属性的短期会话 Cookie；端口和密码不会写入项目、配置或日志。
3. 首次启动等待页面完整加载，不要因为模型列表为空而重装环境；模型文件位于平台的只读模型盘，不会复制到仓库目录。
4. 确认左侧能看到“数据集设置”“训练配置”“开始训练”“全局监控”和“系统诊断”。
5. 打开“系统诊断”，确认 Python 环境已就绪。

连续多次输入错误会触发一分钟登录限速。若字段正确仍被拒绝，确认复制的是当前实例卡片中的 SSH 端口和实例密码；其他实例的端口或密码不能用于本实例。

页面能打开只代表 WebUI 服务正常。还必须完成后面的 3 步训练，才能证明模型加载、数据缓存、反向传播、保存和 checkpoint 全部可用。

## 4. 创建独立训练项目

1. 在主菜单选择“新建项目”。
2. WebUI 会在 `/workspace/DiffPipeForge/output` 下创建一个时间戳项目目录。
3. 为本次训练设置唯一的“输出文件夹名称”，例如：

   ```text
   minimax_h3_smoke_01
   ```

4. 不要让两个训练会话共用同一个项目和输出名称。每次正式训练建议新建项目，或至少更换输出名称。

项目配置和实际训练运行是两层目录：

```text
/workspace/DiffPipeForge/output/<项目时间戳>/
├── dataset.toml
├── evaldataset.toml
├── trainconfig.toml
└── minimax_h3_smoke_01/     <- loss、权重、事件文件和 checkpoint
```

“从检查点恢复”的自动探测只扫描当前配置对应的输出目录，不会把所有项目的 checkpoint 混在一个下拉框中。

## 5. 上传或选择训练数据

浏览器版可直接使用“选择视频和标注”，一次选择视频及同名、精确小写 `.txt` 标注，再点“上传并使用此数据集”。WebUI 会在受控可写目录中创建隔离会话，只有配对和大小校验全部通过才填写输入路径；失败或取消会回收未完成会话。已有服务器数据可点路径旁的文件夹按钮浏览或搜索，不需要借助 Jupyter/SSH。

建议把不同数据集分开存放：

```text
/workspace/data/
├── character_a/
│   ├── 001.mp4
│   ├── 001.txt
│   ├── 002.mp4
│   ├── 002.txt
│   ├── 003.mp4
│   └── 003.txt
└── style_b/
```

3 步烟测只需 3 个短视频。每个视频必须有同名 `.txt`，例如 `001.mp4` 对应 `001.txt`。上传后在“数据集设置”的“输入路径”填：

```text
/workspace/data/character_a
```

不要填 `C:\...`、本机桌面路径、浏览器下载路径或单个视频文件。这里需要的是云端 Linux 目录。

### 烟测数据集字段

在“数据集设置”中填写：

| 字段 | 值 |
| --- | --- |
| 分辨率 | `[384]` |
| 启用宽高比分桶 | 启用 |
| 自定义宽高比分桶 | `[[16, 9]]` |
| 帧数分桶（视频） | `[34]` |
| 重复次数 | `1` |
| 验证集 | 禁用 |

当前界面还会保存最小宽高比 `0.5`、最大宽高比 `2.0` 和分桶数量 `7` 等默认字段。这些字段可以保留；烟测的关键是明确写入 16:9 自定义桶和 34 帧。

保存“训练数据集配置”后再进入下一步。

## 6. 找到并填写四个模型路径

优云模型盘的 MiniMax H3 目录应为：

```text
/model/ModelScope/Comfy-Org/MiniMax-H3
```

在“训练配置”中把“模型架构”设为 `MiniMax H3`，然后按下表填写：

| WebUI 字段 | 优云路径 |
| --- | --- |
| Diffusion 模型路径 | `/model/ModelScope/Comfy-Org/MiniMax-H3/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| VAE 路径 | `/model/ModelScope/Comfy-Org/MiniMax-H3/vae/minimax_h3_video_vae_fp16.safetensors` |
| 音频 VAE 路径 | `/model/ModelScope/Comfy-Org/MiniMax-H3/vae/minimax_h3_audio_vae_fp32.safetensors` |
| 文本编码器路径（Qwen3-VL） | `/model/ModelScope/Comfy-Org/MiniMax-H3/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` |

四项都必填，纯图片训练也不能省略音频 VAE。若路径不存在，返回实例的模型挂载设置检查模型包，不要把大模型复制到项目输出目录。

## 7. 填写 MiniMax H3 烟测参数

在“训练配置”依次设置：

### 模型加载

- 基础数据类型：`bfloat16`；
- Diffusion 模型数据类型：`保留检查点原生量化`；
- 时间步采样方法：`uniform`；
- Shift：`8`；
- Image Shift：`1`；
- CFG 增强训练：`4`；
- 训练 / 去蒸馏适配器：留空。

“保留检查点原生量化”会让配置文件不写 `diffusion_model_dtype`，这是正确结果。

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

保存训练配置。若界面提示 CFG 与训练适配器冲突，清空训练适配器；若提示管道并行错误，把阶段数恢复为 1。

## 8. 通过 WebUI 跑 3 个训练步

1. 打开“开始训练”。
2. 检查配置概览中的输出目录、数据集和模型类型。
3. 第一次烟测将“从检查点恢复”留空。
4. 单卡实例的 GPU 数量填 `1`。
5. 不启用“跳过检查”。
6. 点击“开始训练”。
7. 等待模型读取和数据缓存完成，再观察训练步。大型 Qwen3-VL 文本编码器会让缓存阶段明显长于 3 个训练步。
8. 等待日志出现 3 个有限 loss 和 `TRAINING COMPLETE!`。

如果 24GB 显卡在缓存后仍显存不足，按参数指南中的“仅缓存并退出”流程拆成缓存和训练两次运行，不要立刻改动多个参数。

## 9. 检查 loss、权重和 checkpoint

### 在 WebUI 中检查

1. 打开实时训练日志，确认共有 3 个训练步。
2. 确认 loss 不是 `NaN` 或 `Inf`。3 步内上下波动是正常现象。
3. 打开“全局监控”，选择本次运行的 TensorBoard 日志目录，确认能看到 `train/loss`。
4. 在“开始训练”的输出目录概览中确认本次运行路径。

### 输出目录应包含

- `step3/adapter_model.safetensors`，或同类最终 LoRA 保存目录；
- `events.out.tfevents...`；
- `latest`；
- `global_step.../`；
- `global_step...` 内非空的 `*_model_states.pt`。

恢复训练时选择包含 `latest` 的运行根目录，不要选择 `latest` 文件、`global_step...` 子目录或 LoRA 文件。“从检查点恢复”只在启动时发送，不会写入 `trainconfig.toml`。

## 10. 把烟测改为正式训练

1. 新建项目或更换输出文件夹名称，保留烟测结果作为独立证据。
2. 把输入路径换成完整数据集。
3. 按视频长度使用 17 的倍数帧桶，例如 `[34, 68, 102]`。
4. 按真实素材比例设置宽高比桶，不要对非 16:9 数据强行沿用烟测桶。
5. 清空或删除“最大训练步数 = 3”的限制。
6. 重新设置 epoch、保存间隔、验证集和 LoRA rank。
7. 先保留 `blocks_to_swap=48` 与 Unsloth，确认显存余量后再优化速度。
8. 正式长训前确定输出备份策略。

训练页面现提供“输出根目录”选择器，只显示受控、可写的服务器目录，并标明临时盘、持久盘和只读公共模型盘。优云若实际挂载了可写 `/cloud`，会优先推荐 `/cloud/DiffPipeForge`；本次实例只有只读 `/model` 时则回退到 `/workspace/DiffPipeForge`。`/model` 不能作为输出目录。删除实例前仍要备份任何只存在于 `/workspace` 的结果。

## 11. 停止训练与关闭实例

### 正常训练结束

1. 等日志出现 `TRAINING COMPLETE!`。
2. 确认 LoRA、事件文件、`latest` 和 `global_step...` 已写完。
3. 下载重要权重，或按平台能力把完整运行目录备份到持久存储。
4. 回到优云控制台关机。

普通关机后再次开机，原实例的 `/workspace` 仍在。关机不等于制作新镜像，也不等于把这次训练结果写回最初的市场镜像。

### 中途停止

优先在 WebUI 点击“停止训练”，等待进程退出，再关闭实例。不要直接删除实例，也不要在正在写 checkpoint 时强制断电。

### 删除实例前

至少完成一种保存方式：

- 下载 LoRA 和完整 checkpoint 运行目录；
- 复制到另行挂载的可写持久存储；
- 按平台流程把当前实例另存为私有镜像，并等待制作完成。

`/model` 只读且独立挂载，不能作为备份目的地。从原私有镜像新建另一实例时，也不会自动带上本次运行在 `/workspace` 新产生的文件。

## 12. 管理员排障附录（普通用户不必操作）

镜像中的服务事实如下，供平台维护者核对启动链；普通训练用户不需要手动执行脚本：

- `/start.sh` 会异步调用 `/start.d/20-diffpipe-web.sh`；
- 该启动钩子调用 `/workspace/start_diffpipe_web.sh`；
- WebUI 使用 `/usr/local/miniconda3/envs/py312/bin/python`；
- 服务监听 `0.0.0.0:7860`；
- 启动脚本设置 `DIFFPIPE_WEB_AUTH=youyun`，并且实例主机名必须严格符合 `cpod-...`；主机名不符时服务会拒绝启动，而不是退回无鉴权模式；
- 项目仓库是 `/workspace/DiffPipeForge`。

如果 7860 页面打不开，维护者应先检查实例是否仍在启动、自定义端口是否开放、服务是否监听 7860，再考虑重建实例。不要因为应用入口暂时未出现就重装 PyTorch 或替换现有 Python 环境。
