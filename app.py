# -*- coding: utf-8 -*-
"""
医学影像标注工具 - Flask后端
提供Web界面用于CPR NRRD文件的标注
"""
import os
import sys
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import traceback

# 添加utils目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'utils'))

from nrrd_loader import NRRDLoader, scan_nrrd_files
from annotation_manager import AnnotationManager, Annotation


app = Flask(__name__)
app.config['SECRET_KEY'] = 'medical_annotation_tool_2026'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size

# 全局变量存储当前加载的数据
current_loader = None
current_annotation_manager = None
current_doctor_name = ""
current_data_directory = ""


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/set_doctor', methods=['POST'])
def set_doctor():
    """设置医生名字"""
    global current_doctor_name
    try:
        data = request.json
        doctor_name = data.get('doctor_name', '').strip()
        current_doctor_name = doctor_name
        return jsonify({'success': True, 'doctor_name': current_doctor_name})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/set_directory', methods=['POST'])
def set_directory():
    """设置数据目录并扫描NRRD文件"""
    global current_data_directory, current_doctor_name
    try:
        data = request.json
        directory = data.get('directory', '').strip()

        if not os.path.exists(directory):
            return jsonify({'success': False, 'error': '目录不存在'})

        if not os.path.isdir(directory):
            return jsonify({'success': False, 'error': '路径不是目录'})

        current_data_directory = directory

        # 扫描NRRD文件
        nrrd_files = scan_nrrd_files(directory)
        file_list = []

        for f in nrrd_files:
            file_name = os.path.basename(f)
            base_name = os.path.splitext(file_name)[0]

            # 检查是否存在标注文件
            has_annotation = False
            # 检查带医生名字的标注文件
            if current_doctor_name:
                annotation_file = os.path.join(os.path.dirname(f), f"{base_name}_{current_doctor_name}_label.json")
                if os.path.exists(annotation_file):
                    has_annotation = True

            # 如果没有带医生名字的，检查通用标注文件
            if not has_annotation:
                annotation_file = os.path.join(os.path.dirname(f), f"{base_name}_label.json")
                if os.path.exists(annotation_file):
                    has_annotation = True

            file_list.append({
                'path': f,
                'name': file_name,
                'has_annotation': has_annotation
            })

        return jsonify({
            'success': True,
            'directory': current_data_directory,
            'files': file_list,
            'count': len(file_list)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/load_file', methods=['POST'])
def load_file():
    """加载NRRD文件"""
    global current_loader, current_annotation_manager

    try:
        data = request.json
        file_path = data.get('file_path', '').strip()

        if not os.path.exists(file_path):
            return jsonify({'success': False, 'error': '文件不存在'})

        # 加载NRRD数据
        current_loader = NRRDLoader(file_path)

        # 初始化标注管理器
        current_annotation_manager = AnnotationManager(file_path, current_doctor_name)

        # 获取数据信息
        info = current_loader.get_info()

        # 获取已有标注
        annotations = current_annotation_manager.get_all_annotations()

        # 获取中心切片图像
        center_x = info['center']['x']
        center_y = info['center']['y']
        center_z = info['center']['z']

        x_slice = current_loader.slice_to_base64(
            current_loader.get_slice_with_rotation('x', center_x)
        )
        y_slice = current_loader.slice_to_base64(
            current_loader.get_slice_with_rotation('y', center_y)
        )
        z_slice = current_loader.slice_to_base64(
            current_loader.get_slice_with_rotation('z', center_z)
        )

        return jsonify({
            'success': True,
            'info': info,
            'annotations': annotations,
            'slices': {
                'x': x_slice,
                'y': y_slice,
                'z': z_slice
            }
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/get_slice', methods=['POST'])
def get_slice():
    """获取指定轴向和位置的切片"""
    global current_loader

    if current_loader is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        data = request.json
        axis = data.get('axis', 'z')
        index = int(data.get('index', 0))

        # 验证索引范围
        if axis == 'x':
            max_idx = current_loader.shape[2] - 1
        elif axis == 'y':
            max_idx = current_loader.shape[1] - 1
        else:  # z
            max_idx = current_loader.shape[0] - 1

        index = max(0, min(index, max_idx))

        # 获取切片
        slice_img = current_loader.slice_to_base64(
            current_loader.get_slice_with_rotation(axis, index)
        )

        return jsonify({
            'success': True,
            'slice': slice_img,
            'index': index
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/add_annotation', methods=['POST'])
def add_annotation():
    """添加新标注"""
    global current_annotation_manager

    if current_annotation_manager is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        data = request.json

        # 创建标注对象
        annotation = Annotation(
            z_start=int(data.get('z_start', 0)),
            z_end=int(data.get('z_end', 0)),
            presence=data.get('presence'),
            type_main=data.get('type_main'),
            type_exclude=data.get('type_exclude', []),
            stenosis=data.get('stenosis'),
            confidence=int(data.get('confidence', 1))
        )

        # 添加到管理器
        current_annotation_manager.add_annotation(annotation)

        return jsonify({
            'success': True,
            'annotation': annotation.to_dict()
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/update_annotation', methods=['POST'])
def update_annotation():
    """更新标注"""
    global current_annotation_manager

    if current_annotation_manager is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        data = request.json
        annotation_id = data.get('annotation_id')
        updated_data = data.get('data', {})

        success = current_annotation_manager.update_annotation(annotation_id, updated_data)

        return jsonify({'success': success})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/delete_annotation', methods=['POST'])
def delete_annotation():
    """删除标注"""
    global current_annotation_manager

    if current_annotation_manager is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        data = request.json
        annotation_id = data.get('annotation_id')

        success = current_annotation_manager.remove_annotation(annotation_id)

        return jsonify({'success': success})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/get_annotations', methods=['GET'])
def get_annotations():
    """获取所有标注"""
    global current_annotation_manager

    if current_annotation_manager is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        annotations = current_annotation_manager.get_all_annotations()
        return jsonify({
            'success': True,
            'annotations': annotations
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/save_annotations', methods=['POST'])
def save_annotations():
    """保存标注到文件"""
    global current_annotation_manager

    if current_annotation_manager is None:
        return jsonify({'success': False, 'error': '未加载数据'})

    try:
        success = current_annotation_manager.save()

        if success:
            return jsonify({
                'success': True,
                'file': current_annotation_manager.annotation_file,
                'annotations': current_annotation_manager.get_all_annotations()
            })
        else:
            return jsonify({'success': False, 'error': '保存失败'})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/browse_directory', methods=['POST'])
def browse_directory():
    """浏览文件系统目录"""
    try:
        data = request.json
        path = data.get('path', '')

        # 如果没有提供路径,优先使用项目data目录
        if not path:
            project_root = os.path.dirname(os.path.abspath(__file__))
            data_dir = os.path.join(project_root, 'data')
            # 如果data目录存在，使用它；否则使用用户主目录
            if os.path.exists(data_dir) and os.path.isdir(data_dir):
                path = data_dir
            else:
                path = os.path.expanduser('~')

        # 规范化路径
        path = os.path.abspath(path)

        # 检查路径是否存在
        if not os.path.exists(path):
            return jsonify({'success': False, 'error': '路径不存在'})

        # 如果是文件,返回其父目录
        if os.path.isfile(path):
            path = os.path.dirname(path)

        # 获取父目录
        parent = os.path.dirname(path) if path != os.path.dirname(path) else None

        # 列出子目录
        directories = []
        try:
            items = os.listdir(path)
            for item in sorted(items):
                item_path = os.path.join(path, item)
                if os.path.isdir(item_path):
                    # 检查是否包含NRRD文件
                    nrrd_count = 0
                    try:
                        nrrd_files = scan_nrrd_files(item_path)
                        nrrd_count = len(nrrd_files)
                    except:
                        pass

                    directories.append({
                        'name': item,
                        'path': item_path,
                        'nrrd_count': nrrd_count
                    })
        except PermissionError:
            return jsonify({'success': False, 'error': '没有权限访问此目录'})

        return jsonify({
            'success': True,
            'current_path': path,
            'parent_path': parent,
            'directories': directories
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/get_info', methods=['GET'])
def get_info():
    """获取当前数据信息"""
    global current_loader, current_doctor_name, current_data_directory

    if current_loader is None:
        return jsonify({
            'success': True,
            'loaded': False,
            'doctor_name': current_doctor_name,
            'directory': current_data_directory
        })

    try:
        info = current_loader.get_info()
        return jsonify({
            'success': True,
            'loaded': True,
            'info': info,
            'doctor_name': current_doctor_name,
            'directory': current_data_directory
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description='医学影像标注工具')
    parser.add_argument('--host', type=str, default='127.0.0.1',
                      help='服务器地址 (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=5000,
                      help='服务器端口 (default: 5000)')
    parser.add_argument('--debug', action='store_true',
                      help='启用调试模式')

    args = parser.parse_args()

    print("=" * 60)
    print("医学影像标注工具")
    print("=" * 60)
    print(f"服务器地址: http://{args.host}:{args.port}")
    print("按 Ctrl+C 停止服务器")
    print("=" * 60)

    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
