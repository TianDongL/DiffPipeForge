# MiniMax H3 Training Notes

[English](#english) | [简体中文](#简体中文)

## English

### Training behavior

Any training gradually undistills MiniMax H3. Inference may therefore require CFG; the amount depends on the dataset size and training duration. A de-distillation adapter could address this, but none was available when upstream support was added. Another possible approach is a modified target that retains the model's distilled behavior by using its own unconditional prediction.

MiniMax H3 currently requires a training micro-batch size of `1` because of a limitation in the underlying ComfyUI model implementation. Use `gradient_accumulation_steps` when a larger effective batch is needed.

AdaLN weights are not trained by LoRA. This keeps the resulting LoRA compatible with both the full and pruned H3 checkpoints.

### Caching and memory

The caching phase uses ComfyUI dynamic VRAM, so the text encoder may be larger than available VRAM. For example, the int8 convrot text encoder is about 26GB but can still compute embeddings on a 24GB GPU.

After caching, the text encoder may remain in system RAM and cause an out-of-memory error. If this occurs, finish the cache-only phase, restart DiffPipe Forge, and then train using the existing cache. `--trust_cache` makes cache loading faster, but it must only be used when the underlying dataset files have not changed.

On native Windows, the upstream `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` example may not be supported by the bundled PyTorch build. The important part is separating caching and training into two runs; the allocator flag is optional.

### Quantization and VRAM

LoRAs can be trained directly on quantized ComfyUI weights. The int8 convrot diffusion model and text encoder are recommended. Leave `diffusion_model_dtype` unset to keep the base weights quantized. Quantized base weights only support adapter training; full fine-tuning requires a non-quantized model.

Block swapping is normally required on a 24GB GPU. `blocks_to_swap = 48` is the maximum documented value, and `activation_checkpointing = 'unsloth'` can save substantial VRAM with little overhead.

### Images, video, and audio

Audio is trained automatically when a source video contains an audio track. Video preprocessing is fixed at 24 fps and audio is resampled to 32 kHz. Videos without audio are supported.

Image training is valid. The video VAE encoder can map one image frame to one valid latent frame even though its decoder does not reconstruct that single-frame latent especially well. The latent is still suitable for training. However, training only on images gradually weakens video and motion understanding, so a mixed image/video dataset is preferable.

The optimal timestep distribution and shift are not yet known. `timestep_sample_method = 'uniform'` with `shift = 12` matches the default inference schedule. A lower shift, such as 8, may improve fine detail while reducing large-scale structure and motion learning.

Only T2I and T2V training are implemented. Reference-image, edit, I2V, and first/last-frame conditioning training are not supported. The model retains its existing first/last-frame inference capability when a pure T2V LoRA is applied, and a T2V LoRA is more broadly compatible.

## 简体中文

### 训练行为

任何训练都会让 MiniMax H3 逐渐解除蒸馏，因此推理时可能需要使用 CFG；所需强度取决于数据集规模和训练时长。去蒸馏适配器可能解决这一问题，但上游加入支持时尚无可用方案。另一种可能的方法是使用模型自身的无条件预测构造修改后的训练目标，从而保留原有蒸馏行为。

受底层 ComfyUI 模型实现限制，MiniMax H3 当前要求训练 micro-batch size 为 `1`。如需更大的有效 batch，请使用 `gradient_accumulation_steps`。

LoRA 不训练 AdaLN 权重，因此输出的 LoRA 可以同时兼容完整和剪枝版 H3 检查点。

### 缓存与内存

缓存阶段使用 ComfyUI 动态显存管理，因此文本编码器可以大于显卡可用显存。例如，int8 convrot 文本编码器约为 26GB，但仍可在 24GB 显卡上计算文本嵌入。

缓存完成后，文本编码器可能仍驻留在系统内存中并导致内存不足。遇到这种情况时，请先仅完成缓存，重启 DiffPipe Forge，再复用已有缓存开始训练。`--trust_cache` 可以加快缓存加载，但只能在底层数据集文件未发生变化时使用。

在原生 Windows 上，上游示例中的 `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` 可能不受内置 PyTorch 支持。关键是把缓存和训练拆分为两次运行；该内存分配器参数不是必需项。

### 量化与显存

LoRA 可以直接在 ComfyUI 量化权重上训练，推荐使用 int8 convrot 扩散模型和文本编码器。请不要设置 `diffusion_model_dtype`，以便保持基座权重的量化状态。量化基座仅支持适配器训练；全量微调需要使用非量化模型。

24GB 显卡通常需要启用块交换。文档给出的最大值为 `blocks_to_swap = 48`，同时使用 `activation_checkpointing = 'unsloth'` 可以用较低额外开销进一步节省显存。

### 图片、视频与音频

若源视频包含音轨，音频会自动参与训练。视频固定按 24 fps 预处理，音频重采样为 32 kHz；无音轨视频同样受支持。

图片训练是有效的。视频 VAE 编码器能够把单张图片映射为一个有效 latent 帧，虽然解码器对这一单帧 latent 的重建效果并不理想，但该 latent 仍然适合训练。不过，只使用图片训练会逐渐削弱视频和运动理解能力，因此更推荐混合图片/视频数据集。

目前尚未确定最佳时间步分布和 shift。`timestep_sample_method = 'uniform'` 配合 `shift = 12` 与默认推理调度一致。把 shift 降至 8 等更低值可能改善细节学习，但会削弱大尺度结构和运动学习。

当前仅实现文生图和文生视频训练，不支持参考图、编辑、图生视频或首尾帧条件训练。应用纯 T2V LoRA 后，模型原有的首尾帧推理能力仍会保留，而且 T2V LoRA 的适用模式更加广泛。
