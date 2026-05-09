import torch
from .manager_modules import LinearLayerMemoryManager, ConvLayerMemoryManager

LINEAR_MODULES = [
    "Linear",
    "LoRACompatibleLinear",
    "QLinear",
]
CONV_MODULES = [
    "Conv2d",
    "LoRACompatibleConv",
    "QConv2d",
]

UNMANAGED_MODULES = [
    "LayerNorm", "BatchNorm1d", "BatchNorm2d", "BatchNorm3d",
    "GroupNorm", "InstanceNorm1d", "InstanceNorm2d", "InstanceNorm3d",
    "Embedding", "EmbeddingBag", "RNNBase", "LSTM", "GRU", "RNN", "Conv3d"
]
UNMANAGED_MODULES_INCLUDES = ["RotaryEmbedding", "Norm", "RotaryPosEmbed"]


class MemoryManager:
    def __init__(self, module: torch.nn.Module, process_device: torch.device = torch.device("cpu")):
        self.module: torch.nn.Module = module
        self.process_device: torch.device = process_device
        self.unmanaged_modules: list[torch.nn.Module] = []

    def memory_managed_to(self, *args, **kwargs):
        """拦截 .to() 调用，只移动非托管模块到目标设备。

        重要：绝对不能把 device 传给 _mm_to (原始 .to())，否则会把所有
        被 MemoryManager 管理的权重也移回 GPU，完全破坏分层加载的内存节省。
        非托管模块已在上面的循环中单独处理设备移动。
        """
        # 1) 移动非托管模块
        for module in self.unmanaged_modules:
            if isinstance(module, torch.nn.Parameter):
                module.data = module.data.to(*args, **kwargs)
            else:
                module.to(*args, **kwargs)

        # 2) 只透传 dtype，绝不透传 device
        dtype = None
        if "dtype" in kwargs:
            dtype = kwargs["dtype"]
        elif len(args) > 0:
            for i, arg in enumerate(args):
                if isinstance(arg, torch.dtype):
                    dtype = arg
                    break
        if dtype is not None:
            return self.module._mm_to(dtype=dtype)
        return self.module

    @classmethod
    def attach(
        cls,
        module: torch.nn.Module,
        device: torch.device,
        offload_percent: float = 1.0,
        ignore_modules: list = []
    ):
        """附加内存管理到模块"""
        if hasattr(module, "_memory_manager"):
            return

        module._memory_manager = cls(module, device)
        # 保存原始 to 方法
        module._mm_to = module.to
        module.to = module._memory_manager.memory_managed_to

        # 添加忽略模块到非托管列表
        for im in ignore_modules:
            module._memory_manager.unmanaged_modules.append(im)

        # count ignore modules as processed
        modules_processed = [x for x in ignore_modules]

        # Deterministic counter for offloading decision
        linear_idx = 0
        conv_idx = 0

        # attach to all modules
        for name, sub_module in module.named_modules():
            for child_name, child_module in sub_module.named_modules():
                if (
                    child_module.__class__.__name__ in LINEAR_MODULES
                    and child_module not in modules_processed
                ):
                    skip = False
                    if offload_percent < 1.0:
                        if (linear_idx % 100) >= int(offload_percent * 100):
                            skip = True

                    linear_idx += 1

                    if skip:
                        module._memory_manager.unmanaged_modules.append(child_module)
                    else:
                        LinearLayerMemoryManager.attach(
                            child_module, module._memory_manager
                        )
                        # attach to ARA as well
                        if hasattr(child_module, "ara_lora_ref"):
                            ara = child_module.ara_lora_ref()
                            if ara not in modules_processed:
                                MemoryManager.attach(ara, device)
                    modules_processed.append(child_module)
                elif (
                    child_module.__class__.__name__ in CONV_MODULES
                    and child_module not in modules_processed
                ):
                    skip = False
                    if offload_percent < 1.0:
                        if (conv_idx % 100) >= int(offload_percent * 100):
                            skip = True

                    conv_idx += 1

                    if skip:
                        module._memory_manager.unmanaged_modules.append(child_module)
                    else:
                        ConvLayerMemoryManager.attach(
                            child_module, module._memory_manager
                        )
                        # attach to ARA as well
                        if hasattr(child_module, "ara_lora_ref"):
                            ara = child_module.ara_lora_ref()
                            if ara not in modules_processed:
                                MemoryManager.attach(
                                    ara, device,
                                    offload_percent=offload_percent
                                )
                            modules_processed.append(ara)
                    modules_processed.append(child_module)
                elif child_module.__class__.__name__ in UNMANAGED_MODULES or any(
                    inc in child_module.__class__.__name__
                    for inc in UNMANAGED_MODULES_INCLUDES
                ):
                    module._memory_manager.unmanaged_modules.append(child_module)
                else:
                    continue
