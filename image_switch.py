class JindouyunImageSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "符合尺寸图像": ("IMAGE", {"lazy": True}),
                "不符合尺寸图像": ("IMAGE", {"lazy": True}),
                "符合尺寸信号": ("BOOLEAN", {"forceInput": True}),
                "不符合尺寸信号": ("BOOLEAN", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "switch"
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "根据尺寸判断信号，在符合尺寸图像和不符合尺寸图像之间选择一路输出。"
    SEARCH_ALIASES = ["筋斗云图像尺寸判断", "筋斗云图像切换", "图像尺寸汇合", "尺寸路线判断"]

    @staticmethod
    def _qualified_route(符合尺寸信号, 不符合尺寸信号):
        qualified = bool(符合尺寸信号)
        needs_upscale = bool(不符合尺寸信号)
        if qualified == needs_upscale:
            raise ValueError("符合尺寸信号和不符合尺寸信号必须且只能有一个开启。")
        return qualified

    @classmethod
    def check_lazy_status(
        cls,
        符合尺寸图像,
        不符合尺寸图像,
        符合尺寸信号,
        不符合尺寸信号,
    ):
        qualified = cls._qualified_route(符合尺寸信号, 不符合尺寸信号)
        if qualified and 符合尺寸图像 is None:
            return ["符合尺寸图像"]
        if not qualified and 不符合尺寸图像 is None:
            return ["不符合尺寸图像"]
        return []

    def switch(
        self,
        符合尺寸图像,
        不符合尺寸图像,
        符合尺寸信号,
        不符合尺寸信号,
    ):
        qualified = self._qualified_route(符合尺寸信号, 不符合尺寸信号)
        return (符合尺寸图像 if qualified else 不符合尺寸图像,)
