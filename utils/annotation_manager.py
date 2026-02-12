# -*- coding: utf-8 -*-
"""
标注数据管理工具
处理标注的保存、加载、冲突检测和解决
"""
import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import numpy as np


class Annotation:
    """单个标注对象"""

    def __init__(self, z_start: int, z_end: int,
                 presence: Optional[int] = None,
                 type_main: Optional[int] = None,
                 type_exclude: Optional[List[str]] = None,
                 stenosis: Optional[int] = None,
                 confidence: int = 1,
                 created_at: Optional[str] = None,
                 updated_at: Optional[str] = None,
                 annotation_id: Optional[str] = None):
        """
        初始化标注对象

        Args:
            z_start: 起始Z坐标
            z_end: 结束Z坐标
            presence: 维度A: -1(无斑块), 1(有斑块), 0(怀疑有), None(无法判断)
            type_main: 维度B: 0(不确定), 1(钙化), 2(非钙化), 3(混合)
            type_exclude: 维度C: 列表,可包含 "not_CP", "not_NCP", "not_MP"
            stenosis: 维度D: 0(<25%), 1(25-49%), 2(50-69%), 3(≥70%), 4(无法判断)
            confidence: 维度E: 0(低), 1(中), 2(高)
            created_at: 创建时间戳
            updated_at: 更新时间戳
            annotation_id: 标注ID
        """
        self.z_start = min(z_start, z_end)
        self.z_end = max(z_start, z_end)
        self.presence = presence
        self.type_main = type_main
        self.type_exclude = type_exclude or []
        self.stenosis = stenosis
        self.confidence = confidence

        now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        self.created_at = created_at or now
        self.updated_at = updated_at or now
        self.annotation_id = annotation_id or self._generate_id()

    def _generate_id(self) -> str:
        """生成唯一ID"""
        return f"ann_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'annotation_id': self.annotation_id,
            'z_start': self.z_start,
            'z_end': self.z_end,
            'presence': self.presence,
            'type_main': self.type_main,
            'type_exclude': self.type_exclude,
            'stenosis': self.stenosis,
            'confidence': self.confidence,
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Annotation':
        """从字典创建标注对象"""
        return cls(
            z_start=data['z_start'],
            z_end=data['z_end'],
            presence=data.get('presence'),
            type_main=data.get('type_main'),
            type_exclude=data.get('type_exclude', []),
            stenosis=data.get('stenosis'),
            confidence=data.get('confidence', 1),
            created_at=data.get('created_at') or data.get('timestamp'),  # 兼容旧格式
            updated_at=data.get('updated_at') or data.get('timestamp'),  # 兼容旧格式
            annotation_id=data.get('annotation_id')
        )

    def overlaps_with(self, other: 'Annotation') -> bool:
        """检查是否与另一个标注重叠"""
        return not (self.z_end < other.z_start or self.z_start > other.z_end)

    def get_overlap_range(self, other: 'Annotation') -> Optional[Tuple[int, int]]:
        """获取与另一个标注的重叠区间"""
        if not self.overlaps_with(other):
            return None
        return (max(self.z_start, other.z_start), min(self.z_end, other.z_end))

    def has_higher_priority_than(self, other: 'Annotation') -> bool:
        """
        判断是否比另一个标注有更高的优先级
        优先级规则: confidence高 > updated_at晚
        """
        if self.confidence != other.confidence:
            return self.confidence > other.confidence

        # 如果confidence相同,比较更新时间戳(晚的优先)
        return self.updated_at > other.updated_at


class AnnotationManager:
    """标注管理器"""

    def __init__(self, data_file: str, doctor_name: str = ""):
        """
        初始化标注管理器

        Args:
            data_file: 数据文件路径
            doctor_name: 医生名字
        """
        self.data_file = data_file
        self.doctor_name = doctor_name
        self.annotations: List[Annotation] = []

        # 确定标注文件路径
        base_name = os.path.splitext(os.path.basename(data_file))[0]
        data_dir = os.path.dirname(data_file)

        if doctor_name:
            self.annotation_file = os.path.join(data_dir, f"{base_name}_{doctor_name}_label.json")
        else:
            self.annotation_file = os.path.join(data_dir, f"{base_name}_label.json")

        # 尝试加载现有标注
        self.load()

    def add_annotation(self, annotation: Annotation) -> bool:
        """
        添加新标注

        Args:
            annotation: 标注对象

        Returns:
            是否成功添加
        """
        self.annotations.append(annotation)
        return True

    def remove_annotation(self, annotation_id: str) -> bool:
        """
        删除标注

        Args:
            annotation_id: 标注ID

        Returns:
            是否成功删除
        """
        original_length = len(self.annotations)
        self.annotations = [ann for ann in self.annotations if ann.annotation_id != annotation_id]
        return len(self.annotations) < original_length

    def update_annotation(self, annotation_id: str, updated_data: Dict[str, Any]) -> bool:
        """
        更新标注

        Args:
            annotation_id: 标注ID
            updated_data: 更新的数据

        Returns:
            是否成功更新
        """
        for ann in self.annotations:
            if ann.annotation_id == annotation_id:
                # 更新字段
                if 'z_start' in updated_data:
                    ann.z_start = updated_data['z_start']
                if 'z_end' in updated_data:
                    ann.z_end = updated_data['z_end']
                if 'presence' in updated_data:
                    ann.presence = updated_data['presence']
                if 'type_main' in updated_data:
                    ann.type_main = updated_data['type_main']
                if 'type_exclude' in updated_data:
                    ann.type_exclude = updated_data['type_exclude']
                if 'stenosis' in updated_data:
                    ann.stenosis = updated_data['stenosis']
                if 'confidence' in updated_data:
                    ann.confidence = updated_data['confidence']
                # 更新时间戳
                ann.updated_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                return True
        return False

    def get_annotation(self, annotation_id: str) -> Optional[Annotation]:
        """获取指定ID的标注"""
        for ann in self.annotations:
            if ann.annotation_id == annotation_id:
                return ann
        return None

    def resolve_conflicts(self) -> List[Annotation]:
        """
        解决重叠标注的冲突
        规则: 优先保存置信度高的,如果置信度一样则优先保存标记时间更靠后的

        Returns:
            解决冲突后的标注列表
        """
        if len(self.annotations) <= 1:
            return self.annotations.copy()

        # 按z_start排序
        sorted_anns = sorted(self.annotations, key=lambda a: a.z_start)

        # 用于存储最终结果
        result: List[Annotation] = []

        # 处理每个标注
        for ann in sorted_anns:
            # 检查是否与已有结果中的标注重叠
            conflicts = []
            for existing in result:
                if ann.overlaps_with(existing):
                    conflicts.append(existing)

            if not conflicts:
                # 没有冲突,直接添加
                result.append(ann)
            else:
                # 有冲突,需要解决
                self._resolve_single_conflict(ann, conflicts, result)

        return result

    def _resolve_single_conflict(self, new_ann: Annotation,
                                 conflicts: List[Annotation],
                                 result: List[Annotation]):
        """
        解决单个标注的冲突

        Args:
            new_ann: 新标注
            conflicts: 冲突的标注列表
            result: 结果列表(会被修改)
        """
        # 收集所有涉及的区间
        segments = []  # (z_start, z_end, annotation)

        # 添加新标注
        segments.append((new_ann.z_start, new_ann.z_end, new_ann))

        # 添加冲突的标注
        for conf in conflicts:
            segments.append((conf.z_start, conf.z_end, conf))

        # 找出所有关键点
        points = set()
        for start, end, _ in segments:
            points.add(start)
            points.add(end + 1)  # +1因为end是inclusive的

        sorted_points = sorted(points)

        # 对每个区间,确定最高优先级的标注
        for i in range(len(sorted_points) - 1):
            seg_start = sorted_points[i]
            seg_end = sorted_points[i + 1] - 1

            # 找出覆盖这个区间的所有标注
            covering = []
            for start, end, ann in segments:
                if start <= seg_start and seg_end <= end:
                    covering.append(ann)

            if covering:
                # 选择优先级最高的
                winner = max(covering, key=lambda a: (a.confidence, a.updated_at))

                # 检查是否需要添加到结果
                # 如果结果中最后一个标注与这个区间的winner相同且连续,则扩展
                if result and result[-1].annotation_id == winner.annotation_id and \
                   result[-1].z_end + 1 == seg_start:
                    result[-1].z_end = seg_end
                else:
                    # 创建新的标注片段
                    segment_ann = Annotation(
                        z_start=seg_start,
                        z_end=seg_end,
                        presence=winner.presence,
                        type_main=winner.type_main,
                        type_exclude=winner.type_exclude.copy(),
                        stenosis=winner.stenosis,
                        confidence=winner.confidence,
                        created_at=winner.created_at,
                        updated_at=winner.updated_at,
                        annotation_id=winner.annotation_id
                    )
                    result.append(segment_ann)

        # 从结果中移除被处理的冲突标注
        for conf in conflicts:
            result.remove(conf)

    def save(self) -> bool:
        """
        保存标注到文件(自动解决冲突)

        Returns:
            是否成功保存
        """
        try:
            # 解决冲突
            resolved = self.resolve_conflicts()

            # 准备保存数据
            data = {
                'data_file': os.path.basename(self.data_file),
                'doctor_name': self.doctor_name,
                'last_modified': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'annotations': [ann.to_dict() for ann in resolved]
            }

            # 保存到文件
            os.makedirs(os.path.dirname(self.annotation_file), exist_ok=True)
            with open(self.annotation_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            # 更新当前标注列表为解决冲突后的版本
            self.annotations = resolved

            return True

        except Exception as e:
            print(f"保存标注失败: {e}")
            return False

    def load(self) -> bool:
        """
        从文件加载标注

        Returns:
            是否成功加载
        """
        if not os.path.exists(self.annotation_file):
            return False

        try:
            with open(self.annotation_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # 恢复标注
            self.annotations = [Annotation.from_dict(ann_data)
                              for ann_data in data.get('annotations', [])]

            # 更新医生名字(如果文件中有)
            if 'doctor_name' in data and not self.doctor_name:
                self.doctor_name = data['doctor_name']

            return True

        except Exception as e:
            print(f"加载标注失败: {e}")
            return False

    def get_all_annotations(self) -> List[Dict[str, Any]]:
        """获取所有标注(字典格式)"""
        return [ann.to_dict() for ann in self.annotations]

    def get_annotations_at_z(self, z: int) -> List[Annotation]:
        """获取指定Z位置的所有标注"""
        return [ann for ann in self.annotations if ann.z_start <= z <= ann.z_end]
