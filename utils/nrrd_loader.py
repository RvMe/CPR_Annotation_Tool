# -*- coding: utf-8 -*-
"""
NRRD数据加载工具
用于加载和处理CPR NRRD格式的医学影像数据
"""
import os
import sys
import numpy as np
import SimpleITK as sitk
from typing import Tuple, Dict, Any
import base64
from io import BytesIO
from PIL import Image
import tempfile
import shutil


class NRRDLoader:
    """NRRD文件加载和处理类"""

    def __init__(self, file_path: str):
        """
        初始化NRRD加载器

        Args:
            file_path: NRRD文件路径
        """
        self.file_path = file_path
        self.volume = None
        self.spacing = None
        self.origin = None
        self.direction = None
        self.metadata = {}
        self.shape = None
        self._temp_file = None  # 用于存储临时文件路径

        self._load_data()
        self._determine_orientation()

    def __del__(self):
        """析构函数,清理临时文件"""
        if self._temp_file and os.path.exists(self._temp_file):
            try:
                os.remove(self._temp_file)
            except:
                pass

    def _has_non_ascii(self, path: str) -> bool:
        """检查路径是否包含非ASCII字符(如中文)"""
        try:
            path.encode('ascii')
            return False
        except UnicodeEncodeError:
            return True

    def _load_data(self):
        """加载NRRD文件"""
        if not os.path.exists(self.file_path):
            raise FileNotFoundError(f"文件不存在: {self.file_path}")

        # 规范化路径
        normalized_path = os.path.abspath(self.file_path)

        # 检查路径是否包含中文或其他Unicode字符
        # SimpleITK在Windows上无法处理Unicode路径,需要使用临时文件
        if os.name == 'nt' and self._has_non_ascii(normalized_path):
            # 创建临时文件(在系统临时目录中,路径通常是纯ASCII)
            temp_fd, self._temp_file = tempfile.mkstemp(suffix='.nrrd')
            os.close(temp_fd)  # 关闭文件描述符

            # 复制文件到临时位置
            try:
                shutil.copy2(normalized_path, self._temp_file)
                read_path = self._temp_file
            except Exception as e:
                if self._temp_file and os.path.exists(self._temp_file):
                    os.remove(self._temp_file)
                raise Exception(f"无法复制文件到临时目录: {str(e)}")
        else:
            # 在Windows上,将反斜杠转换为正斜杠
            if os.name == 'nt':
                normalized_path = normalized_path.replace('\\', '/')
            read_path = normalized_path

        # 使用SimpleITK读取NRRD
        img = sitk.ReadImage(read_path)

        # 获取数据数组 (Z, Y, X)
        self.volume = sitk.GetArrayFromImage(img).astype(np.float32)

        # 获取spacing (Z, Y, X)
        self.spacing = np.array(img.GetSpacing()[::-1])

        # 获取其他信息
        self.origin = img.GetOrigin()
        self.direction = img.GetDirection()

        # 获取元数据
        for key in img.GetMetaDataKeys():
            self.metadata[key] = img.GetMetaData(key)

        self.shape = self.volume.shape  # (Z, Y, X)

        # 标准化intensity范围到0-255便于显示
        self._normalize_intensity()

    def _normalize_intensity(self):
        """将intensity标准化到0-255范围"""
        vmin = np.percentile(self.volume, 1)
        vmax = np.percentile(self.volume, 99)
        self.volume = np.clip(self.volume, vmin, vmax)
        self.volume = ((self.volume - vmin) / (vmax - vmin + 1e-8) * 255).astype(np.uint8)

    def _determine_orientation(self):
        """确定XYZ轴方向,并将长边竖直放置"""
        nz, ny, nx = self.shape

        # 确定X和Y方向哪个更长
        # X对应width, Y对应height
        self.x_axis = 2  # X轴在数组的第2维
        self.y_axis = 1  # Y轴在数组的第1维
        self.z_axis = 0  # Z轴在数组的第0维

        # 判断是否需要旋转(让长边竖直放置)
        # 如果X > Y,则需要旋转90度让X竖直
        self.need_rotate = nx > ny

        # 计算中心切片位置
        self.center_x = nx // 2
        self.center_y = ny // 2

    def get_slice(self, axis: str, index: int) -> np.ndarray:
        """
        获取指定轴向的切片

        Args:
            axis: 'x', 'y', 或 'z'
            index: 切片索引

        Returns:
            2D numpy array
        """
        if axis == 'x':
            # X轴切面: 固定X坐标,得到(Z, Y)
            slice_data = self.volume[:, :, index]  # (Z, Y)
        elif axis == 'y':
            # Y轴切面: 固定Y坐标,得到(Z, X)
            slice_data = self.volume[:, index, :]  # (Z, X)
        elif axis == 'z':
            # Z轴切面: 固定Z坐标,得到(Y, X)
            slice_data = self.volume[index, :, :]  # (Y, X)
        else:
            raise ValueError(f"未知的axis: {axis}")

        return slice_data

    def get_slice_with_rotation(self, axis: str, index: int) -> np.ndarray:
        """
        获取切片并根据需要旋转(让长边竖直)

        Args:
            axis: 'x', 'y', 或 'z'
            index: 切片索引

        Returns:
            2D numpy array
        """
        slice_data = self.get_slice(axis, index)

        # 对于X和Y轴视图,如果需要旋转
        if self.need_rotate and axis in ['x', 'y']:
            slice_data = np.rot90(slice_data, k=-1)  # 顺时针旋转90度

        return slice_data

    def slice_to_base64(self, slice_data: np.ndarray) -> str:
        """
        将切片数据转换为base64编码的PNG图像

        Args:
            slice_data: 2D numpy array

        Returns:
            base64编码的图像字符串
        """
        # 确保数据是uint8
        if slice_data.dtype != np.uint8:
            slice_data = slice_data.astype(np.uint8)

        # 创建PIL图像
        img = Image.fromarray(slice_data, mode='L')

        # 转换为PNG并编码为base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{img_str}"

    def get_info(self) -> Dict[str, Any]:
        """
        获取数据集基本信息

        Returns:
            包含数据集信息的字典
        """
        nz, ny, nx = self.shape
        sz, sy, sx = self.spacing

        return {
            'filename': os.path.basename(self.file_path),
            'shape': {
                'z': int(nz),
                'y': int(ny),
                'x': int(nx)
            },
            'spacing': {
                'z': float(sz),
                'y': float(sy),
                'x': float(sx)
            },
            'center': {
                'x': int(self.center_x),
                'y': int(self.center_y),
                'z': int(nz // 2)
            },
            'need_rotate': bool(self.need_rotate),
            'physical_size': {
                'z': float(nz * sz),
                'y': float(ny * sy),
                'x': float(nx * sx)
            }
        }

    def get_z_slice_range(self, z_start: int, z_end: int) -> Tuple[int, int]:
        """
        验证并调整Z轴切片范围

        Args:
            z_start: 起始Z索引
            z_end: 结束Z索引

        Returns:
            调整后的(z_start, z_end)
        """
        nz = self.shape[0]
        z_start = max(0, min(z_start, nz - 1))
        z_end = max(0, min(z_end, nz - 1))

        if z_start > z_end:
            z_start, z_end = z_end, z_start

        return z_start, z_end


def scan_nrrd_files(directory: str) -> list:
    """
    扫描目录中的所有NRRD文件

    Args:
        directory: 目录路径

    Returns:
        NRRD文件路径列表
    """
    if not os.path.exists(directory):
        return []

    nrrd_files = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.lower().endswith('.nrrd'):
                full_path = os.path.join(root, file)
                nrrd_files.append(full_path)

    return sorted(nrrd_files)
