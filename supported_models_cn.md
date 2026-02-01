# 摘要
| Model          | LoRA | Full Fine Tune | fp8/quantization |
|----------------|------|----------------|------------------|
|SDXL            |✅    |✅              |❌                |
|Flux            |✅    |✅              |✅                |
|LTX-Video       |✅    |❌              |❌                |
|HunyuanVideo    |✅    |❌              |✅                |
|Cosmos          |✅    |❌              |❌                |
|Lumina Image 2.0|✅    |✅              |❌                |
|Wan2.1          |✅    |✅              |✅                |
|Chroma          |✅    |✅              |✅                |
|HiDream         |✅    |❌              |✅                |
|SD3             |✅    |❌              |✅                |
|Cosmos-Predict2 |✅    |✅              |✅                |
|OmniGen2        |✅    |❌              |❌                |
|Flux Kontext    |✅    |✅              |✅                |
|Wan2.2          |✅    |✅              |✅                |
|Qwen-Image      |✅    |✅              |✅                |
|Qwen-Image-Edit |✅    |✅              |✅                |
|Qwen-Image-Edit-2509 |✅    |✅              |✅                |
|HunyuanImage-2.1|✅    |✅              |✅                |
|AuraFlow        |✅    |❌              |✅                |
|Z-Image         |✅    |✅              |❌                |
|HunyuanVideo-1.5|✅    |✅              |✅                |
|Qwen-Image-Edit-2511 |✅    |✅              |✅                |
|Qwen-Image-Edit-2512 |✅    |✅              |✅                |
|Flux 2（both dev and klein）          |✅    |✅              |✅                |


## SDXL
```
[model]
type = 'sdxl'
checkpoint_path = '/data2/imagegen_models/sdxl/sd_xl_base_1.0_0.9vae.safetensors'
dtype = 'bfloat16'
# 你可以通过设置此选项来训练v-prediction模型（例如NoobAI vpred）。
#v_pred = true
# 支持最小SNR。含义与sd-scripts相同
#min_snr_gamma = 5
# 支持去偏估计损失。含义与sd-scripts相同。
#debiased_estimation_loss = true
# 你可以为unet和文本编码器设置不同的学习率。如果其中一个未设置，则将应用优化器的学习率。
unet_lr = 4e-5
text_encoder_1_lr = 2e-5
text_encoder_2_lr = 2e-5
```
与其他模型不同，对于SDXL，文本嵌入不会被缓存，并且文本编码器会被训练。

SDXL可以进行全量微调。只需删除配置文件中的[adapter]表即可。你将需要48GB显存。2×24GB GPU在设置pipeline_stages=2时可以工作。

SDXL的LoRA以Kohya sd-scripts格式保存。SDXL的全量微调模型以原始SDXL检查点格式保存。

## Flux
```
[model]
type = 'flux'
# Flux的Huggingface Diffusers目录路径
diffusers_path = '/data2/imagegen_models/FLUX.1-dev'
# 你可以从BFL格式的检查点中覆盖transformer。
#transformer_path = '/data2/imagegen_models/flux-dev-single-files/consolidated_s6700-schnell.safetensors'
dtype = 'bfloat16'
# Flux在训练LoRA时支持transformer使用fp8。
transformer_dtype = 'float8'
# 依赖分辨率的时间步偏移，朝向更多噪声。含义与sd-scripts相同。
flux_shift = true
# 对于FLEX.1-alpha，你可以绕过引导嵌入，这是训练该模型的推荐方式。
#bypass_guidance_embedding = true
```
对于Flux，你可以通过将transformer_path设置为原始黑森林实验室（BFL）格式的检查点来覆盖transformer权重。例如，上面的配置从Diffusers格式的FLUX.1-dev加载模型，但如果取消注释transformer_path，则会从Flux Dev De-distill加载transformer。

Flux的LoRA以Diffusers格式保存。

## LTX-Video
```
[model]
type = 'ltx-video'
diffusers_path = '/data2/imagegen_models/LTX-Video'
# 将此指向其中一个单一检查点文件，以从中加载transformer和VAE。
single_file_path = '/data2/imagegen_models/LTX-Video/ltx-video-2b-v0.9.1.safetensors'
dtype = 'bfloat16'
# 可以以fp8加载transformer。
#transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
# 使用第一个视频帧作为条件的概率（即i2v训练）。
#first_frame_conditioning_p = 1.0
```
你可以通过使用single_file_path来训练更新的LTX-Video版本。请注意，你仍然需要将diffusers_path设置为原始模型文件夹（它从这里获取文本编码器）。仅支持t2i和t2v训练。

LTX-Video的LoRA以ComfyUI格式保存。

## HunyuanVideo
```
[model]
type = 'hunyuan-video'
# 可以完全从为官方推理脚本设置的ckpt路径加载 Hunyuan Video。
#ckpt_path = '/home/anon/HunyuanVideo/ckpts'
# 或者你可以通过指向所有ComfyUI文件来加载它。
transformer_path = '/data2/imagegen_models/hunyuan_video_comfyui/hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors'
vae_path = '/data2/imagegen_models/hunyuan_video_comfyui/hunyuan_video_vae_bf16.safetensors'
llm_path = '/data2/imagegen_models/hunyuan_video_comfyui/llava-llama-3-8b-text-encoder-tokenizer'
clip_path = '/data2/imagegen_models/hunyuan_video_comfyui/clip-vit-large-patch14'
# 所有模型使用的基础数据类型。
dtype = 'bfloat16'
# Hunyuan Video在训练LoRA时支持transformer使用fp8。
transformer_dtype = 'float8'
# 用于训练的时间步采样方法。可以是logit_normal或uniform。
timestep_sample_method = 'logit_normal'
```
HunyuanVideo的LoRA以Diffusers风格的格式保存。键根据原始模型命名，并以“transformer.”为前缀。此格式可直接在ComfyUI中使用。

## Cosmos
```
[model]
type = 'cosmos'
# 将这些路径指向ComfyUI文件。
transformer_path = '/data2/imagegen_models/cosmos/cosmos-1.0-diffusion-7b-text2world.pt'
vae_path = '/data2/imagegen_models/cosmos/cosmos_cv8x8x8_1.0.safetensors'
text_encoder_path = '/data2/imagegen_models/cosmos/oldt5_xxl_fp16.safetensors'
dtype = 'bfloat16'
```
已初步支持Cosmos（text2world扩散变体）。与HunyuanVideo相比，Cosmos在消费级硬件上进行微调并不理想。

1. Cosmos支持固定的、有限的分辨率和帧长度集合。正因为如此，7b模型的训练实际上比HunyuanVideo（12b参数）更慢，因为你不能像使用Hunyuan那样通过在低分辨率图像上训练来节省资源。而且视频训练几乎是不可能的，除非你有大量的显存，因为对于视频，你必须使用完整的121帧长度。
2. Cosmos在从纯图像训练到视频的泛化方面似乎要差得多。
3. Cosmos基础模型在其了解的内容类型方面受到更多限制，这使得针对大多数概念的微调更加困难。

我可能不会继续积极支持Cosmos。所有必要的部分都已具备，如果你真的想尝试训练它，是可以做到的。但如果出现问题，不要期望我会花时间去修复。

Cosmos的LoRA以ComfyUI格式保存。

## Lumina Image 2.0
```
[model]
type = 'lumina_2'
# 将这些路径指向ComfyUI文件。
transformer_path = '/data2/imagegen_models/lumina-2-single-files/lumina_2_model_bf16.safetensors'
llm_path = '/data2/imagegen_models/lumina-2-single-files/gemma_2_2b_fp16.safetensors'
vae_path = '/data2/imagegen_models/lumina-2-single-files/flux_vae.safetensors'
dtype = 'bfloat16'
lumina_shift = true
```
参见[Lumina 2示例数据集配置](../examples/recommended_lumina_dataset_config.toml)，其中展示了如何添加标题前缀并包含推荐的分辨率设置。

除了LoRA之外，Lumina 2还支持全量微调。它可以在单个24GB GPU上以1024x1024分辨率进行微调。对于全量微调，删除或注释掉配置中的[adapter]块。如果在24GB显存下进行全量微调，你需要使用替代优化器来减少显存使用：
```
[optimizer]
type = 'adamw8bitkahan'
lr = 5e-6
betas = [0.9, 0.99]
weight_decay = 0.01
eps = 1e-8
gradient_release = true
```

这使用了带有Kahan求和的自定义AdamW8bit优化器（bf16训练所需），并启用了实验性的梯度释放以节省更多显存。如果你仅在512分辨率下训练，可以移除梯度释放部分。如果你有>24GB的GPU，或者多个GPU并使用流水线并行，或许可以直接使用普通的adamw优化器类型。

Lumina 2的LoRA以ComfyUI格式保存。

## Wan2.1
```
[model]
type = 'wan'
ckpt_path = '/data2/imagegen_models/Wan2.1-T2V-1.3B'
dtype = 'bfloat16'
# 训练LoRA时，你可以为transformer使用fp8。
#transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
```

支持t2v和i2v的Wan2.1变体。将ckpt_path设置为原始模型检查点目录，例如[Wan2.1-T2V-1.3B](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B)。

（可选）你可以跳过从原始检查点下载transformer和UMT5文本编码器，而是传入ComfyUI safetensors文件的路径。

下载检查点但跳过transformer和UMT5：
```
huggingface-cli download Wan-AI/Wan2.1-T2V-1.3B --local-dir Wan2.1-T2V-1.3B --exclude "diffusion_pytorch_model*" "models_t5*"
```

然后使用此配置：
```
[model]
type = 'wan'
ckpt_path = '/data2/imagegen_models/Wan2.1-T2V-1.3B'
transformer_path = '/data2/imagegen_models/wan_comfyui/wan2.1_t2v_1.3B_bf16.safetensors'
llm_path = '/data2/imagegen_models/wan_comfyui/wrapper/umt5-xxl-enc-bf16.safetensors'
dtype = 'bfloat16'
# 训练LoRA时，你可以为transformer使用fp8。
#transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
```
你仍然需要ckpt_path，只是它可以缺少transformer文件和/或UMT5。transformer/UMT5可以从原生ComfyUI重新打包的文件，或Kijai的包装器扩展的文件中加载。此外，你可以混合搭配组件，例如，在训练中使用来自ComfyUI重新打包仓库的transformer与来自Kijai的包装器仓库的UMT5 safetensors，或其他组合。

对于i2v训练，你**必须**在仅包含视频的数据集上训练。否则训练脚本会出错崩溃。每个视频片段的第一帧用作图像条件，模型被训练以预测视频的其余部分。请注意video_clip_mode设置。如果未设置，它默认为'single_beginning'，这对于i2v训练是合理的，但如果你在t2v训练期间将其设置为其他值，对于i2v可能不是你想要的。只有14B模型有i2v变体，并且它需要在视频上训练，因此显存要求很高。如果没有足够的显存，请根据需要使用块交换。

Wan2.1的LoRA以ComfyUI格式保存。

## Chroma
```
[model]
type = 'chroma'
diffusers_path = '/data2/imagegen_models/FLUX.1-dev'
transformer_path = '/data2/imagegen_models/chroma/chroma-unlocked-v10.safetensors'
dtype = 'bfloat16'
# 训练LoRAs时，你可以选择以fp8加载transformer。
transformer_dtype = 'float8'
flux_shift = true
```
Chroma是一个在架构上经过修改并从Flux Schnell微调而来的模型。这些修改非常显著，以至于它有自己的模型类型。将transformer_path设置为Chroma单一模型文件，并将diffusers_path设置为Flux Dev或Schnell Diffusers文件夹（需要Diffusers模型来加载VAE和文本编码器）。

Chroma的LoRA以ComfyUI格式保存。

## HiDream
```
[model]
type = 'hidream'
diffusers_path = '/data/imagegen_models/HiDream-I1-Full'
llama3_path = '/data2/models/Meta-Llama-3.1-8B-Instruct'
llama3_4bit = true
dtype = 'bfloat16'
transformer_dtype = 'float8'
# 可以使用nf4量化以节省更多显存。
#transformer_dtype = 'nf4'
max_llama3_sequence_length = 128
# 可以使用依赖分辨率的时间步偏移，如Flux。不确定结果是否更好。
#flux_shift = true
```

仅测试了完整版。Dev和Fast版本可能无法正常工作，因为它们经过蒸馏，并且你无法设置引导值。

**HiDream在低于1024的分辨率下表现不佳**。该模型使用与Flux相同的训练目标和VAE，因此两者的损失值可以直接比较。当我与Flux比较时，在768分辨率下损失值有适度下降。在512分辨率下损失值有严重下降，并且在512分辨率下推理会产生完全失真的图像。

官方推理代码对所有文本编码器使用128的最大序列长度。你可以通过更改max_llama3_sequence_length来更改llama3（承担几乎所有权重）的序列长度。值为256会导致模型在任何训练开始之前的稳定验证损失略有增加，因此存在一些质量下降。如果你的许多标题长于128个令牌，可能值得增加此值，但这未经测试。我不会将其增加到256以上。

由于Llama3文本嵌入的计算方式，Llama3文本编码器必须在训练期间保持加载状态并计算其嵌入，而不是预先缓存。否则，缓存将占用大量磁盘空间。这会增加内存使用，但你可以将Llama3设置为4bit，对验证损失几乎没有可测量的影响。

如果不进行块交换，你将需要48GB显存，或带有流水线并行的2×24GB。有足够的块交换，你可以在单个24GB GPU上训练。使用nf4量化也允许在24GB显存下训练，但可能会有一些质量下降。

HiDream的LoRA以ComfyUI格式保存。

## Stable Diffusion 3
```
[model]
type = 'sd3'
diffusers_path = '/data2/imagegen_models/stable-diffusion-3.5-medium'
dtype = 'bfloat16'
#transformer_dtype = 'float8'
#flux_shift = true
```

支持Stable Diffusion 3的LoRA训练。你需要模型的完整Diffusers文件夹。已在SD3.5 Medium和Large上测试。

SD3的LoRA以Diffusers格式保存。此格式可在ComfyUI中使用。

## Cosmos-Predict2
```
[model]
type = 'cosmos_predict2'
transformer_path = '/data2/imagegen_models/Cosmos-Predict2-2B-Text2Image/model.pt'
vae_path = '/data2/imagegen_models/comfyui-models/wan_2.1_vae.safetensors'
t5_path = '/data2/imagegen_models/comfyui-models/oldt5_xxl_fp16.safetensors'
dtype = 'bfloat16'
#transformer_dtype = 'float8_e5m2'
```

Cosmos-Predict2支持LoRA和全量微调。目前仅支持t2i模型变体。

将transformer_path设置为原始模型检查点，vae_path设置为ComfyUI Wan VAE，t5_path设置为ComfyUI [旧版T5模型文件](https://huggingface.co/comfyanonymous/cosmos_1.0_text_encoder_and_VAE_ComfyUI/blob/main/text_encoders/oldt5_xxl_fp16.safetensors)。请注意，这是较旧版本的T5，不是与其他模型更常用的版本。

该模型似乎比大多数模型对fp8/量化更敏感。float8_e4m3fn**不会**很好地工作。如果你使用fp8 transformer，请使用配置中所示的float8_e5m2。如果可能，尽量避免在2B模型上使用fp8。在14B transformer上使用float8_e5m2似乎没问题，并且是在24GB GPU上训练所必需的。

float8_e5m2也是目前（撰写本文时）唯一可用于推理的数据类型。但请注意，在ComfyUI中，**当应用于float8_e5m2模型时，LoRA不能很好地工作**。生成的图像非常嘈杂。我猜在将LoRA权重与此数据类型合并时的随机舍入会引入太多噪声。此问题不影响训练，因为LoRA权重是分离的，在训练期间不会合并。简而言之：你可以使用```transformer_dtype = 'float8_e5m2'```来为14B训练LoRA，但在ComfyUI中应用LoRA时不要在此模型上使用fp8。更新：使用GGUF模型权重时，LoRA将正常工作，因为在这种情况下，LoRA不会合并到量化权重中。

Cosmos-Predict2的LoRA以ComfyUI格式保存。

## OmniGen2
```
[model]
type = 'omnigen2'
diffusers_path = '/data2/imagegen_models/OmniGen2'
dtype = 'bfloat16'
#flux_shift = true
```

支持OmniGen2的LoRA训练。将```diffusers_path```设置为原始模型检查点目录。仅支持t2i训练（即单张图像和标题）。

OmniGen2的LoRA以ComfyUI格式保存。

## Flux Kontext
```
[model]
type = 'flux'
# 或者直接指向Flux Kontext Diffusers文件夹，无需transformer_path
diffusers_path = '/data2/imagegen_models/FLUX.1-dev'
transformer_path = '/data2/imagegen_models/flux-dev-single-files/flux1-kontext-dev.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'float8'
#flux_shift = true
```

支持Flux Kontext，适用于标准t2i数据集和编辑数据集。权重形状与Flux Dev 100%兼容，因此如果你已经有Dev Diffusers文件夹，可以使用transformer_path指向Kontext单一模型文件以节省空间。

参见[Flux Kontext示例数据集配置](../examples/flux_kontext_dataset.toml)了解如何配置数据集。

**重要**：控制/上下文图像的纵横比应与目标图像大致相同。所有纵横比和大小分桶都是针对目标图像进行的。然后，控制图像会被调整大小并裁剪以匹配目标图像大小。如果控制图像的纵横比与目标图像差异很大，将会裁剪掉控制图像的很多部分。

Flux Kontext的LoRA以Diffusers格式保存，可在ComfyUI中使用。

## Wan2.2
从检查点加载：
```
[model]
type = 'wan'
ckpt_path = '/data/imagegen_models/Wan2.2-T2V-A14B'
transformer_path = '/data/imagegen_models/Wan2.2-T2V-A14B/low_noise_model'
dtype = 'bfloat16'
transformer_dtype = 'float8'
min_t = 0
max_t = 0.875
```
或者，从ComfyUI文件加载以节省空间：
```
[model]
type = 'wan'
ckpt_path = '/data/imagegen_models/Wan2.2-T2V-A14B'
transformer_path = '/data/imagegen_models/comfyui-models/wan2.2_t2v_low_noise_14B_fp16.safetensors'
llm_path = '/data2/imagegen_models/comfyui-models/umt5_xxl_fp16.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'float8'
```

5B模型也受支持，但仅用于t2v/t2i训练，不支持i2v。

LoRA以ComfyUI格式保存。

### 模型加载说明
从ComfyUI文件加载时，你仍然需要包含VAE和配置文件的检查点文件夹，但它不需要transformer或T5。你可以像这样下载并跳过这些文件：
```
huggingface-cli download Wan-AI/Wan2.2-T2V-A14B --local-dir Wan2.2-T2V-A14B --exclude "models_t5*" "*/diffusion_pytorch_model*"
```
对于Wan2.2 A14B，如果你完全从检查点文件夹加载，需要使用```transformer_path```指向你想要训练的模型子文件夹，即低噪声或高噪声。

### 时间步范围
Wan2.2 A14B有两个模型：低噪声和高噪声。它们在推理期间处理时间步范围的不同部分，当时间步达到某个边界时在模型之间切换。t=0表示无噪声，t=1表示完全噪声。这些模型是独立的；你可以为其中一个或两个训练LoRA。

我找不到Wan团队为每个模型训练的确切时间步细节，但推测他们是按照推理时的使用方式进行训练的。对于T2V模型，配置的推理边界时间步为0.875。对于I2V，它是0.9。你可以（并且应该）使用```min_t```和```max_t```参数来限制适合模型的训练时间步范围。例如，上面的第一个模型配置设置了低噪声T2V模型的时间步范围。我不知道训练时间步范围是否应该与推理边界完全匹配。对于高噪声T2V模型，你将使用：
```
min_t = 0.875
max_t = 1
```
像这样控制时间步范围，即使你使用```shift```或```flux_shift```参数来偏移时间步分布，也能正常工作。

或者，人们注意到低噪声模型可以单独使用。因此，你可以像训练Wan2.1一样训练低噪声模型，而无需限制时间步范围。

## Qwen-Image 或者  Qwen Image Edit 2512
```
[model]
type = 'qwen_image'
diffusers_path = '/data/imagegen_models/Qwen-Image'
dtype = 'bfloat16'
transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
```
或从单个文件加载：
```
[model]
type = 'qwen_image'
transformer_path = '/data/imagegen_models/comfyui-models/qwen_image_bf16.safetensors'
text_encoder_path = '/data/imagegen_models/comfyui-models/qwen_2.5_vl_7b.safetensors'
vae_path = '/data/imagegen_models/Qwen-Image/vae/diffusion_pytorch_model.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
```
在第二种格式中，```transformer_path```和```text_encoder_path```应该是ComfyUI文件，但```vae_path```需要是**Diffusers VAE**（权重键名完全不同，ComfyUI VAE目前不支持）。即使你将transformer转换为float8，也应该使用bf16文件；fp8_scaled权重根本无法工作，fp8权重可能质量稍低，因为训练脚本尝试将一些权重保持在更高精度。如果你同时提供```diffusers_path```和各个模型路径，它将优先从单个路径读取子模型。

在撰写本文时，你需要最新的Diffusers：
```
pip uninstall diffusers
pip install git+https://github.com/huggingface/diffusers
```

Qwen-Image的LoRA以ComfyUI格式保存。

### 在单个24GB GPU上训练LoRA
- 你将需要块交换。参见[示例24GB显存配置](../examples/qwen_image_24gb_vram.toml)，其中所有设置都是正确的。
- 使用可扩展段CUDA功能：```PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config /home/anon/code/diffusion-pipe-configs/tmp.toml```
- 使用640的数据集分辨率。这是模型训练时使用的分辨率之一，可能比512稍好。
- 如果你使用更高的LoRA秩或更高的分辨率，可能需要增加blocks_to_swap。

## Qwen-Image-Edit
```
[model]
type = 'qwen_image'
diffusers_path = '/data/imagegen_models/Qwen-Image'  # 或者，Qwen-Image-Edit Diffusers文件夹
# 仅当你使用Qwen-Image Diffusers模型而不是Qwen-Image-Edit时需要
transformer_path = '/data/imagegen_models/comfyui-models/qwen_image_edit_bf16.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
```
配置和训练Qwen-Image-Edit与Flux-Kontext相同。参见[示例数据集配置](../examples/flux_kontext_dataset.toml)。同样的数据集注意事项适用。参考图像会被调整大小到目标图像最终所在的任何大小分桶，因此你的参考图像需要与目标图像具有大致相同的纵横比，否则它们会被过度裁剪。

该模型接受的输入比T2I训练更大，因此速度更慢，使用更多显存。我不知道是否可以在24GB显存上训练它。也许如果进行足够的块交换。

Qwen-Image-Edit的LoRA以ComfyUI格式保存。



# HunyuanImage-2.1（混元图像模型2.1）
使用兼容ComfyUI的模型文件。
```
[model]
type = 'hunyuan_image'  # 模型类型 = '混元图像模型'
transformer_path = '/data/imagegen_models/comfyui-models/hunyuanimage2.1.safetensors'  # Transformer模块路径
vae_path = '/data/imagegen_models/comfyui-models/hunyuan_image_2.1_vae_fp16.safetensors'  # VAE（变分自编码器）模块路径
text_encoder_path = '/data/imagegen_models/comfyui-models/qwen_2.5_vl_7b.safetensors'  # 文本编码器路径
byt5_path = '/data/imagegen_models/comfyui-models/byt5_small_glyphxl_fp16.safetensors'  # ByT5（字节级Transformer模型）路径
dtype = 'bfloat16'  # 数据类型 = '16位脑浮点数'
transformer_dtype = 'float8'  # Transformer模块数据类型 = '8位浮点数'
```

## 关于图像分辨率的说明
由于VAE（变分自编码器）的高空间压缩特性以及DiT（扩散Transformer）模型的架构设计，在特定图像分辨率下，HunyuanImage-2.1的计算量和内存需求，与其他模型（如Flux、Qwen、Lumina等）在**一半图像边长分辨率**下的需求相同。  
也就是说，HunyuanImage-2.1在1024分辨率下的计算量，等同于Flux、Qwen、Lumina等模型在512分辨率下的计算量。  

你可以选择在512分辨率下进行训练以提升速度——实践表明，即便该分辨率对于HunyuanImage-2.1而言相对较低，模型仍能较好地完成学习。但根据数据集的不同，可能更适合在1024及以上分辨率下训练，尤其是当你希望从数据集中学习到独特的细粒度细节时。

HunyuanImage-2.1的LoRA（低秩适应）模型以ComfyUI格式保存。需要特别注意的是，这意味着其部分键名（key names）与原始模型结构存在差异。如果你计划在ComfyUI以外的平台使用该LoRA模型，请务必留意这一点。

## AuraFlow
```
[model]
type = 'auraflow'
# 所有这些路径都指向ComfyUI文件。
transformer_path = '/data2/imagegen_models/comfyui-models/auraflow/pony-v7-base.safetensors'
text_encoder_path = '/data2/imagegen_models/comfyui-models/auraflow/umt5_auraflow.fp16.safetensors'
vae_path = '/data2/imagegen_models/comfyui-models/auraflow/sdxl_vae.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'float8'
timestep_sample_method = 'logit_normal'
max_sequence_length = 768  # 对于Pony-V7，max_sequence_length=768#768。基础AuraFlow为256。
```


## Z-Image
```
[model]
type = 'z_image'
diffusion_model = '/data2/imagegen_models/comfyui-models/z_image_turbo_bf16.safetensors'
vae = '/data2/imagegen_models/comfyui-models/flux_vae.safetensors'
text_encoders = [
    {path = '/data2/imagegen_models/comfyui-models/qwen_3_4b.safetensors', type = 'lumina2'}
]
# Use if training Z-Image-Turbo
merge_adapters = ['/data2/imagegen_models/comfyui-models/zimage_turbo_training_adapter_v1.safetensors']
dtype = 'bfloat16'
```

所有模型文件都应该是[ComfyUI版本](https://huggingface.co/Comfy-Org/z_image_turbo).如果训练Z-Image-Turbo，请确保合并[适配器](https://huggingface.co/ostris/zimage_turbo_training_adapter).归功于Ostris和[AI Toolkit](https://github.com/ostris/ai-toolkit)为了制作这个适配器。

Z-Image LoRA以ComfyUI格式保存。这与扩散器格式不同。

## HunyuanVideo-1.5
```
[model]
type = 'hunyuan_video_15'
diffusion_model = '/data2/imagegen_models/comfyui-models/hunyuanvideo1.5_480p_t2v_fp16.safetensors'
vae = '/data2/imagegen_models/comfyui-models/hunyuanvideo15_vae_fp16.safetensors'
text_encoders = [
    {paths = [
        '/data/imagegen_models/comfyui-models/qwen_2.5_vl_7b.safetensors',
        '/data/imagegen_models/comfyui-models/byt5_small_glyphxl_fp16.safetensors',
    ], type = 'hunyuan_video_15'},
]
dtype = 'bfloat16'
diffusion_model_dtype = 'float8'
timestep_sample_method = 'logit_normal'
# Higher shift (default is 1) might be useful for video training.
#shift = 3
```

所有模型文件都应该是ComfyUI版本. LoRA以ComfyUI格式保存

## Qwen Image Edit 2511

```
[model]
type = 'qwen2511'
diffusers_path = 'E:/comfyuiMQ/ComfyUI_windows_portable/ComfyUI/custom_nodes/Diffusion_pipe_in_ComfyUI_Win/Qwen-Image-Edit-2511'
或者使用comfyui版本的模型
transformer_path = '1/1/1/qwen_image_edit_2511_bf16.safetensors'
text_encoder_path = '2/2/2/qwen_2.5_vl_7b_fp8_scaled.safetensors'
vae_path = '3/3/3/qwen_image_vae.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'bfloat16'
可能需要更高的block swap，block swap≤57
```
LoRA均以ComfyUI格式保存
同时，支持多图编辑训练

```
[[directory]]
path = '/input/test'
control_paths = ['/input/test1', '/input/test2']
```
或者像这样单图编辑训练
```
[[directory]]
path = '/input/test'
control_path = '/input/test1'
num_repeats = 1
```
注意，控制提示词需要放在path路径下，对应的节点需要放在目标路径下（target_path）


## Qwen Image Edit 2509

```
[model]
type = 'qwen_image'
diffusers_path = '/blablabla/Qwen-Image-Edit-2509'
#或者使用comfyui版本的模型
transformer_path = '/1/1/1/qwen_image_edit_2509.safetensors'
text_encoder_path = '/2/2/2/qwen 2.5_vl_7b_fp8_scaled.safetensors'
vae_path = '/3/3/3/qwen_image_vae.safetensors'
dtype = 'bfloat16'
transformer_dtype = 'bfloat16'
```
LoRA均以ComfyUI格式保存
#同时，支持多图编辑训练

```
[[directory]]
path = '/input/test'
control_paths = ['/input/test1', '/input/test2']
```
#或者像这样单图编辑训练
```
[[directory]]
path = '/input/test'
control_path = '/input/test1'
num_repeats = 1
```
#注意，控制提示词需要放在path路径下，对应的节点需要放在目标路径下（target_path）



## Flux 2
Dev:
```
[model]
type = 'flux2'
diffusion_model = '/home/anon/ComfyUI/models/diffusion_models/flux2-dev.safetensors'
vae = '/home/anon/ComfyUI/models/vae/flux2-vae.safetensors'
text_encoders = [
    {path = '/home/anon/ComfyUI/models/text_encoders/mistral_3_small_flux2_fp8.safetensors', type = 'flux2'}
]
dtype = 'bfloat16'
diffusion_model_dtype = 'float8'
timestep_sample_method = 'logit_normal'
shift = 3
```

Klein 4b:
```
[model]
type = 'flux2'
diffusion_model = '/data2/imagegen_models/comfyui-models/flux-2-klein-base-4b.safetensors'
vae = '/home/anon/ComfyUI/models/vae/flux2-vae.safetensors'
text_encoders = [
    {path = '/data2/imagegen_models/comfyui-models/qwen_3_4b.safetensors', type = 'flux2'}
]
dtype = 'bfloat16'
#除非你的显存非常低，否则4b可能不需要fp8。
#diffusion_model_dtype = 'float8'
timestep_sample_method = 'logit_normal'
shift = 3
```

Klein 9b:
```
[model]
type = 'flux2'
diffusion_model = '/data2/imagegen_models/comfyui-models/flux-2-klein-base-9b.safetensors'
vae = '/home/anon/ComfyUI/models/vae/flux2-vae.safetensors'
text_encoders = [
    {path = '/data2/imagegen_models/comfyui-models/qwen_3_8b.safetensors', type = 'flux2'}
]
dtype = 'bfloat16'
diffusion_model_dtype = 'float8'
timestep_sample_method = 'logit_normal'
shift = 3
```

注：
- 对所有模型使用与ComfyUI兼容的权重。
- 仅支持T2I训练。编辑数据集当前无法工作。
- 如果没有块交换，Dev需要至少48GB的VRAM用于LoRA训练，可能还需要大量的系统RAM。
- Flux2 VAE有更多的通道，因此时间步长偏移值(shift )大于1是有用的。我不知道最好的值，但3似乎很好。
- 确保你使用了正确的文本编码器。每个版本使用不同的text encoder。如果使用了错误的缓存，缓存仍将运行，但在尝试训练时会出现形状不匹配错误。
- 文本编码器可以是fp8版本。不过，扩散模型应该是全量的。如果fp8扩散模型是纯格式的（可能是Klein），它也许能跑，但fp8_scaled/fp8_mixed肯定跑不起来。

LoRA以ComfyUI格式保存。
